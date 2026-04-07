import type { Express, Request } from "express";
import fs from "fs";
import path from "path";
import { requireAuth, requireRoleAtLeast } from "../auth";
import { storage } from "../storage";
import { logger } from "../logger";
import { parseExcelFiles, processCapacityData, generateExcelExport } from "../pipeline";
import { getCanonicalWeekBoundaries } from "@shared/schema";
import {
  runAutomationJob,
  waitForJob,
  getJob,
  listJobs,
  getCurrentJob,
  isRunning,
  getDownloadPath,
  type JobConfig,
} from "./automation-engine";

// ─── Branch config from env ───────────────────────────────────────────────────
export interface BranchPPConfig {
  workspaceBranch: string;
  plannerArea: string;
}

function getBranchPPConfig(branchId: string): BranchPPConfig | null {
  const raw = process.env.PEOPLE_PLANNER_BRANCH_CONFIG;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, BranchPPConfig>;
    return map[branchId] ?? null;
  } catch {
    return null;
  }
}

// ─── Per-branch runtime config override (stored in-memory, overrides env) ────
const branchConfigOverrides = new Map<string, Partial<BranchPPConfig>>();

function getMergedBranchConfig(branchId: string): BranchPPConfig | null {
  const base = getBranchPPConfig(branchId);
  const override = branchConfigOverrides.get(branchId);
  if (!base && !override) return null;
  return { ...base, ...override } as BranchPPConfig;
}

// ─── Report type → pipeline field name mapping ───────────────────────────────
const REPORT_TEMPLATE_MAP: Record<string, { fieldName: string }> = {
  visitsExport:                  { fieldName: "guaranteed" },
  careGiverExport:               { fieldName: "cgData" },
  careGiverAvailabilityExport:   { fieldName: "availability" },
};

// ─── Export template names ────────────────────────────────────────────────────
const REPORT_EXPORT_TEMPLATES: Record<string, string> = {
  visitsExport:                "Care Pro Guaranteed Hours",
  careGiverExport:             "CG Data Export",
  careGiverAvailabilityExport: "CG Availability Export",
};

// ─── Shared export buffer ─────────────────────────────────────────────────────
let latestAutomationExportBuffer: Buffer | null = null;

export function getAutomationExportBuffer(): Buffer | null {
  return latestAutomationExportBuffer;
}

// ─── Session tracking (branch-scoped) ─────────────────────────────────────────
interface PipelineSession {
  sessionId: string;
  status: "running" | "completed" | "failed";
  error?: string;
  jobIds: string[];
  phase: string;
  startedAt: string;
  completedAt?: string;
  branchId: string;
  initiatedByUserId?: string;
  result?: unknown;
}

const activeSessions = new Map<string, PipelineSession>();

// ─── Access guard helper ──────────────────────────────────────────────────────
function canAccessBranch(req: Request, branchId: string): boolean {
  const session = (req as any).session;
  if (!session?.userId) return false;
  if (session.userRole === "admin") return true;
  // For non-admins: only allow access to sessions they initiated
  // (branch-level check is handled by the caller comparing session.branchId)
  return true; // auth middleware already verified the user is logged in
}

function sessionBelongsToUser(session: PipelineSession, req: Request): boolean {
  const userSession = (req as any).session;
  if (!userSession) return false;
  if (userSession.userRole === "admin") return true;
  // Non-admins can only see sessions they initiated
  if (session.initiatedByUserId && session.initiatedByUserId !== userSession.userId) return false;
  return true;
}

// ─── Register routes ──────────────────────────────────────────────────────────
export function registerPeoplePlannerRoutes(app: Express): void {
  // Only register if credentials are configured (or can be configured later)
  // Routes are always registered but gracefully return 503 if not configured

  // GET /api/pp/health — check automation is configured, usable, and Playwright accessible
  app.get("/api/pp/health", requireAuth, async (req, res) => {
    const hasCredentials = !!(process.env.ACCESS_EMAIL && process.env.ACCESS_PASSWORD);
    const hasBranchConfig = !!process.env.PEOPLE_PLANNER_BRANCH_CONFIG;
    const branchId = req.query.branchId as string | undefined;
    const branchConfigured = branchId ? !!getMergedBranchConfig(branchId) : hasBranchConfig;

    // Probe Playwright availability (non-blocking, 5s timeout)
    let playwrightReady = false;
    try {
      const { chromium } = await import("playwright");
      const browser = await Promise.race([
        chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
      ]) as import("playwright").Browser;
      await browser.close();
      playwrightReady = true;
    } catch {
      // Playwright not available or failed to launch — report as not ready
    }

    res.json({
      enabled: hasCredentials && playwrightReady,
      credentialsConfigured: hasCredentials,
      branchConfigured,
      playwrightReady,
    });
  });

  // GET /api/pp/config — get merged branch config (admin only)
  app.get("/api/pp/config", requireAuth, requireRoleAtLeast("admin"), (req, res) => {
    const branchId = req.query.branchId as string | undefined;
    if (!branchId) {
      return res.status(400).json({ error: "branchId query param is required" });
    }
    const config = getMergedBranchConfig(branchId);
    res.json({
      branchId,
      config: config ?? null,
      hasEnvConfig: !!getBranchPPConfig(branchId),
      hasOverride: branchConfigOverrides.has(branchId),
    });
  });

  // PUT /api/pp/config — update branch config override (admin only)
  app.put("/api/pp/config", requireAuth, requireRoleAtLeast("admin"), (req, res) => {
    const { branchId, workspaceBranch, plannerArea } = req.body as {
      branchId?: string;
      workspaceBranch?: string;
      plannerArea?: string;
    };

    if (!branchId) {
      return res.status(400).json({ error: "branchId is required" });
    }

    const existing = branchConfigOverrides.get(branchId) ?? {};
    const updated: Partial<BranchPPConfig> = {
      ...existing,
      ...(workspaceBranch !== undefined ? { workspaceBranch } : {}),
      ...(plannerArea !== undefined ? { plannerArea } : {}),
    };
    branchConfigOverrides.set(branchId, updated);

    res.json({
      branchId,
      config: getMergedBranchConfig(branchId),
    });
  });

  // GET /api/pp/status — current running job status
  app.get("/api/pp/status", requireAuth, (_req, res) => {
    res.json({
      isRunning: isRunning(),
      currentJob: getCurrentJob() ?? null,
    });
  });

  // GET /api/pp/jobs — list recent jobs; non-admins see only their own jobs
  app.get("/api/pp/jobs", requireAuth, (req, res) => {
    const userSession = (req as any).session;
    const branchId = req.query.branchId as string | undefined;

    let jobs = listJobs();

    const isAdmin = userSession?.userRole === "admin";

    if (isAdmin) {
      // Admins: filter by branchId if provided
      if (branchId) {
        jobs = jobs.filter(j => j.config?.branchId === branchId);
      }
    } else {
      // Non-admins: restrict to jobs they initiated (via session tracking)
      const mySessionJobIds = new Set<string>();
      for (const s of activeSessions.values()) {
        if (s.initiatedByUserId === userSession?.userId) {
          for (const id of s.jobIds) mySessionJobIds.add(id);
        }
      }
      jobs = jobs.filter(j => mySessionJobIds.has(j.id));
      // Additionally filter by branchId within user's jobs
      if (branchId) {
        jobs = jobs.filter(j => j.config?.branchId === branchId);
      }
    }

    res.json(jobs);
  });

  // GET /api/pp/jobs/:jobId — single job details (branch/user scoped)
  app.get("/api/pp/jobs/:jobId", requireAuth, (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    const userSession = (req as any).session;
    if (userSession?.userRole !== "admin") {
      // Verify this job belongs to a session initiated by this user
      const ownsJob = Array.from(activeSessions.values()).some(
        s => s.initiatedByUserId === userSession?.userId && s.jobIds.includes(job.id)
      );
      if (!ownsJob) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    res.json(job);
  });

  // GET /api/pp/download/:jobId — download a single exported file (user scoped)
  app.get("/api/pp/download/:jobId", requireAuth, (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job || !job.downloadReady || !job.fileName) {
      return res.status(404).json({ error: "No download available for this job" });
    }

    const userSession = (req as any).session;
    if (userSession?.userRole !== "admin") {
      const ownsJob = Array.from(activeSessions.values()).some(
        s => s.initiatedByUserId === userSession?.userId && s.jobIds.includes(job.id)
      );
      if (!ownsJob) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const filePath = getDownloadPath(req.params.jobId);
    if (!filePath) {
      return res.status(404).json({ error: "File not found on disk" });
    }
    res.download(filePath, job.fileName, (err) => {
      if (err) logger.error({ err, jobId: req.params.jobId }, "Error sending download file");
    });
  });

  // POST /api/pp/run — run all 3 reports and feed into pipeline
  app.post("/api/pp/run", requireAuth, requireRoleAtLeast("scheduler"), async (req, res) => {
    if (!process.env.ACCESS_EMAIL || !process.env.ACCESS_PASSWORD) {
      return res.status(503).json({
        error: "People Planner credentials not configured. Please set ACCESS_EMAIL and ACCESS_PASSWORD in environment secrets.",
      });
    }

    try {
      const { weekStartDate, branchId: requestedBranchId } = req.body as {
        weekStartDate: string;
        branchId: string;
      };

      if (!weekStartDate || !requestedBranchId) {
        return res.status(400).json({ error: "weekStartDate and branchId are required" });
      }

      const branch = await storage.getBranchById(requestedBranchId);
      if (!branch) {
        return res.status(400).json({ error: "Invalid branch" });
      }

      const ppConfig = getMergedBranchConfig(requestedBranchId);
      if (!ppConfig) {
        return res.status(400).json({
          error: `No People Planner configuration found for branch "${branch.displayName}". Please set PEOPLE_PLANNER_BRANCH_CONFIG in environment secrets or configure via PUT /api/pp/config.`,
        });
      }

      const startDate = new Date(weekStartDate);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      const fmt = (d: Date) => d.toISOString().split("T")[0];

      const reportTypes = ["visitsExport", "careGiverExport", "careGiverAvailabilityExport"] as const;

      const sessionId = `ppsession_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const initiatedByUserId = (req as any).session?.userId ?? "unknown";

      runPipelineSession(
        sessionId,
        requestedBranchId,
        branch.displayName,
        ppConfig,
        fmt(startDate),
        fmt(endDate),
        reportTypes,
        initiatedByUserId
      ).catch(err => {
        logger.error({ sessionId, err }, "Pipeline session failed outside handler");
        const existing = activeSessions.get(sessionId);
        if (existing && existing.status === "running") {
          activeSessions.set(sessionId, {
            ...existing,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
            phase: "error",
            completedAt: new Date().toISOString(),
          });
        }
      });

      return res.status(202).json({ sessionId });

    } catch (error) {
      logger.error({ error }, "Error starting People Planner run");
      return res.status(500).json({ error: "Failed to start automation" });
    }
  });

  // GET /api/pp/session/:sessionId — poll session status (user scoped)
  app.get("/api/pp/session/:sessionId", requireAuth, (req, res) => {
    const session = activeSessions.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (!sessionBelongsToUser(session, req)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const jobs = session.jobIds.map(id => getJob(id)).filter(Boolean);
    res.json({ ...session, jobs });
  });
}

// ─── Pipeline session runner ──────────────────────────────────────────────────
async function runPipelineSession(
  sessionId: string,
  branchId: string,
  branchDisplayName: string,
  ppConfig: BranchPPConfig,
  startDate: string,
  endDate: string,
  reportTypes: readonly ("visitsExport" | "careGiverExport" | "careGiverAvailabilityExport")[],
  initiatedByUserId: string
): Promise<void> {
  const session: PipelineSession = {
    sessionId,
    status: "running",
    jobIds: [],
    phase: "starting",
    startedAt: new Date().toISOString(),
    branchId,
    initiatedByUserId,
  };
  activeSessions.set(sessionId, session);

  try {
    const downloadedBuffers: Record<string, Buffer> = {};

    for (const reportType of reportTypes) {
      const templateMap = REPORT_TEMPLATE_MAP[reportType];
      const exportTemplate = REPORT_EXPORT_TEMPLATES[reportType];

      session.phase = `downloading_${reportType}`;
      activeSessions.set(sessionId, session);

      const config: JobConfig = {
        workspaceBranch: ppConfig.workspaceBranch,
        plannerArea: ppConfig.plannerArea,
        startDate,
        endDate,
        reportType,
        exportType: "Excel",
        exportTemplate,
        selectAllCareGivers: reportType === "careGiverAvailabilityExport",
        branchId, // populated so /api/pp/jobs can filter by branch
      };

      const jobId = await runAutomationJob(config);
      session.jobIds.push(jobId);
      activeSessions.set(sessionId, session);

      const completedJob = await waitForJob(jobId, 300000);

      if (completedJob.status === "failed") {
        throw new Error(`${reportType} download failed: ${completedJob.error}`);
      }

      const filePath = completedJob.filePath ?? getDownloadPath(jobId);
      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error(`Downloaded file not found on disk for ${reportType}`);
      }

      downloadedBuffers[templateMap.fieldName] = fs.readFileSync(filePath);
      logger.info({ reportType, fieldName: templateMap.fieldName, bytes: downloadedBuffers[templateMap.fieldName].length }, "File buffered");
    }

    session.phase = "processing";
    activeSessions.set(sessionId, session);

    const availabilityBuf = downloadedBuffers["availability"];
    const guaranteedBuf   = downloadedBuffers["guaranteed"];
    const cgDataBuf       = downloadedBuffers["cgData"];

    if (!availabilityBuf || !guaranteedBuf || !cgDataBuf) {
      throw new Error("One or more downloaded files are missing");
    }

    const parsedData = await parseExcelFiles(availabilityBuf, guaranteedBuf, cgDataBuf, undefined, branchId);

    const result = await processCapacityData(
      parsedData.availability,
      parsedData.guaranteed,
      parsedData.demand,
      parsedData.cgData,
      { ghWorkbookBuffer: guaranteedBuf, branchId }
    );

    if (parsedData.warnings.length > 0) {
      result.warnings = [...(result.warnings || []), ...parsedData.warnings];
    }

    const exportBuffer = await generateExcelExport(result, result.cleanedRecords, parsedData.cgData);
    latestAutomationExportBuffer = exportBuffer;
    fs.writeFileSync(path.join(process.cwd(), "capacity_dashboard.xlsx"), exportBuffer);

    try {
      await storage.saveBranchUpload({
        branchId,
        uploadType: "guaranteedHours",
        fileBuffer: guaranteedBuf.toString("base64"),
        originalFileName: "Care Pro Guaranteed Hours.xlsx",
        fileSize: guaranteedBuf.length,
        sha256: null,
      });
    } catch (err) {
      logger.warn({ err }, "Failed to persist GH buffer to DB (non-fatal)");
    }

    await storage.clearAllVisits(branchId);

    try {
      const { extractEmployeeVisitsFromGHExcel } = await import("../excel-visit-extractor");
      const weekDates = result.dailySummary?.map(d => d.date) ?? [];
      if (weekDates.length > 0) {
        const scheduleMap = await extractEmployeeVisitsFromGHExcel(guaranteedBuf, weekDates, branchId, storage);
        const visitRows: import("@shared/schema").InsertCpScheduledVisit[] = [];
        for (const [cpName, dayMap] of scheduleMap) {
          for (const [date, entries] of dayMap) {
            for (const entry of entries) {
              visitRows.push({
                branchId,
                cpName,
                clientName: entry.clientName,
                clientLat:  entry.lat  != null ? String(entry.lat)  : null,
                clientLng:  entry.lng  != null ? String(entry.lng)  : null,
                clientPostcode: entry.postcode ?? null,
                date,
                startTime: entry.startTime,
                endTime:   entry.endTime,
              });
            }
          }
        }
        await storage.upsertCpScheduledVisitsByDates(branchId, weekDates, visitRows);
        await storage.enforceRetentionCpScheduledVisits(branchId, 8);
      }
    } catch (err) {
      logger.warn({ err }, "Failed to persist CP visits (non-fatal)");
    }

    if (result.dailySummary && result.dailySummary.length > 0) {
      const { weekStart, weekEnd } = getCanonicalWeekBoundaries(result.dailySummary[0].date);
      await storage.saveCapacityAnalysis({
        branchId,
        weekStartDate: weekStart,
        weekEndDate:   weekEnd,
        kpis:          result.kpis,
        dailySummary:  result.dailySummary,
        employeesByDate: result.employeesByDate,
        employeeSummaryByDate: result.employeeSummaryByDate || {},
        warnings: result.warnings || [],
      });
    }

    session.status     = "completed";
    session.phase      = "complete";
    session.completedAt = new Date().toISOString();
    session.result     = { kpis: result.kpis, warnings: result.warnings };
    activeSessions.set(sessionId, session);

    logger.info({ sessionId, branchId }, "Automation pipeline session completed");

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    session.status     = "failed";
    session.error      = message;
    session.phase      = "error";
    session.completedAt = new Date().toISOString();
    activeSessions.set(sessionId, session);
    logger.error({ sessionId, err }, "Pipeline session failed");
    throw err;
  }
}
