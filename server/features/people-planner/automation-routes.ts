import type { Express, Request } from "express";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { requireAuth, requireRoleAtLeast } from "../../features/auth/auth";
import { storage } from "../../storage";
import { logger } from "../../infrastructure/logger";
import { parseExcelFiles, processCapacityData, generateExcelExport } from "../../pipeline";
import { getCanonicalWeekBoundaries } from "@shared/schema";
import {
  runAutomationJob,
  waitForJob,
  getJob,
  listJobs,
  getCurrentJob,
  isRunning,
  getQueueLength,
  getDownloadPath,
  type JobConfig,
} from "./automation-engine";

// ─── Branch config ────────────────────────────────────────────────────────────
export interface BranchPPConfig {
  /** Direct Access Workspace URL for this branch */
  branchUrl: string;
  /** Exact Franchise name to select in PP export forms (Area is always left as "All") */
  plannerArea?: string;
}

/**
 * Built-in mapping from DB branch ID → People Planner connection config.
 *
 * plannerArea: the exact Franchise name to select in the PP export form for this branch.
 * In People Planner the Franchise dropdown is the branch filter; Area is always left as "All".
 * Branches that share a PP instance MUST have plannerArea set so the correct Franchise is
 * chosen and only that branch's data is downloaded.
 * Solo branches (one franchise per PP) can omit plannerArea — the franchise is inferred
 * from the Access Workspace URL slug.
 */
const DEFAULT_BRANCH_PP_CONFIGS: Record<string, BranchPPConfig> = {
  // Ayr & Kilmarnock — solo PP, no area filter needed
  "7bc2f2fe-c0e4-4b55-b32b-04954f4f86a7": {
    branchUrl: "https://go.accessacloud.com/o/home-instead-uk-ayr-kilmarnock/",
  },
  // Glasgow North — shares PP with North Lanarkshire; select Glasgow North area
  "2f706320-5585-4e3c-8eb2-6c624acd7fca": {
    branchUrl: "https://go.accessacloud.com/o/home-instead-uk-glasgow-north/",
    plannerArea: "Glasgow North",
  },
  // North Lanarkshire — shares PP with Glasgow North; select North Lanarkshire area
  "c812f593-9ec6-4a18-b48e-c847cc2eac81": {
    branchUrl: "https://go.accessacloud.com/o/home-instead-uk-glasgow-north/",
    plannerArea: "North Lanarkshire & Glasgow East",
  },
  // Aberdeen — shares PP with Perth; select Aberdeen area
  "0d087ea2-68ed-45f3-9738-85de38d4ec9e": {
    branchUrl: "https://go.accessacloud.com/o/home-instead-uk-perthshire/",
    plannerArea: "Home Instead Aberdeen",
  },
  // Perth — shares PP with Aberdeen; select Perthshire area
  "92a144e1-b9d5-4ec6-b6fb-e8269ddf521d": {
    branchUrl: "https://go.accessacloud.com/o/home-instead-uk-perthshire/",
    plannerArea: "Home Instead Perthshire",
  },
  // East Lothian and Midlothian — shares PP with Scottish Borders
  "b661f59b-750f-4d75-9343-31bdc3fd9c60": {
    branchUrl: "https://go.accessacloud.com/o/home-instead-uk-east-lothian/",
    plannerArea: "East Lothian and Midlothian",
  },
  // Scottish Borders — shares PP with East Lothian
  "2587f931-4a8c-4afd-bedf-6621ba55f0b4": {
    branchUrl: "https://go.accessacloud.com/o/home-instead-uk-east-lothian/",
    plannerArea: "Scottish Borders",
  },
  // Glasgow South — solo PP, no area filter needed
  "d3859b52-cfbb-4c23-b94a-4ca4f5351d65": {
    branchUrl: "https://go.accessacloud.com/o/home-instead-uk-glasgow-south/",
  },
  // Stirling & Falkirk — solo PP, no area filter needed
  "311ed83e-0715-4a83-9cdf-ca6b7792b624": {
    branchUrl: "https://go.accessacloud.com/o/home-instead-uk-sterling-falkirk/",
  },
  // West Fife / Dunfermline — solo PP, no area filter needed
  "7b10cb7c-5b1a-4f0a-bce2-d82cc23427d4": {
    branchUrl: "https://go.accessacloud.com/o/home-instead-uk-dunfermline/",
  },
};

/**
 * Look up branch config from PEOPLE_PLANNER_BRANCH_CONFIG env var (optional override).
 * Env var format: { "<branchId>": { "branchUrl": "...", "plannerArea": "..." }, ... }
 */
function getBranchPPConfig(branchId: string): Partial<BranchPPConfig> | null {
  const raw = process.env.PEOPLE_PLANNER_BRANCH_CONFIG;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, Partial<BranchPPConfig>>;
    return map[branchId] ?? null;
  } catch {
    return null;
  }
}

// ─── Per-branch runtime config override (stored in-memory, overrides env) ────
const branchConfigOverrides = new Map<string, Partial<BranchPPConfig>>();

function getMergedBranchConfig(branchId: string): BranchPPConfig | null {
  const defaultConfig = DEFAULT_BRANCH_PP_CONFIGS[branchId];
  const envConfig = getBranchPPConfig(branchId);
  const override = branchConfigOverrides.get(branchId);

  // Must have at least a branch URL (from defaults, env, or override)
  const branchUrl = override?.branchUrl ?? envConfig?.branchUrl ?? defaultConfig?.branchUrl;
  if (!branchUrl) return null;

  // plannerArea: override > env > default (so built-in area mapping is always used unless overridden)
  const plannerArea = override?.plannerArea ?? envConfig?.plannerArea ?? defaultConfig?.plannerArea;

  return { branchUrl, plannerArea };
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

/** Returns the oldest running session (the one currently being processed by the browser). */
function getAnyRunningSession(): PipelineSession | undefined {
  const running = Array.from(activeSessions.values())
    .filter(s => s.status === "running")
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  return running[0];
}

/**
 * Estimate wait time in minutes.
 * Each pipeline session runs 3 jobs, each ~2 min, plus ~2 min login/branch-switch overhead = ~8 min per session.
 * We count running sessions + jobs still in the low-level queue (÷3 for jobs→sessions).
 */
function estimateRetryMinutes(): number {
  const runningSessions = Array.from(activeSessions.values()).filter(s => s.status === "running").length;
  const queuedJobs = getQueueLength();
  const queuedSessions = Math.ceil(queuedJobs / 3);
  const totalSessions = Math.max(1, runningSessions + queuedSessions);
  // 8 min per session is a conservative estimate
  return totalSessions * 8;
}

// ─── Access guard helpers ─────────────────────────────────────────────────────
function isAdmin(req: Request): boolean {
  return req.session?.userRole === "admin";
}

function sessionBelongsToUser(ppSession: PipelineSession, req: Request): boolean {
  if (!req.session?.userId) return false;
  if (isAdmin(req)) return true;
  return !ppSession.initiatedByUserId || ppSession.initiatedByUserId === req.session.userId;
}

export function listSessions(): PipelineSession[] {
  return Array.from(activeSessions.values())
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 30);
}

// ─── Register routes ──────────────────────────────────────────────────────────
export function registerPeoplePlannerRoutes(app: Express): void {
  // Only register if credentials are configured (or can be configured later)
  // Routes are always registered but gracefully return 503 if not configured

  // GET /api/pp/health — check automation is configured, usable, and Playwright accessible
  app.get("/api/pp/health", requireAuth, async (req, res) => {
    const hasCredentials = !!(process.env.ACCESS_EMAIL && process.env.ACCESS_PASSWORD);
    const branchId = req.query.branchId as string | undefined;
    // Branch URLs are built-in for all known branches; check the specific branch if provided
    const branchConfigured = branchId
      ? !!getMergedBranchConfig(branchId)
      : Object.keys(DEFAULT_BRANCH_PP_CONFIGS).length > 0;

    // Probe Playwright availability (non-blocking, 10s timeout)
    let playwrightReady = false;
    try {
      // Prefer the system Chromium (installed via Nix) over Playwright's managed download
      let systemChromium: string | undefined;
      try {
        const found = execSync(
          "which chromium 2>/dev/null || which chromium-browser 2>/dev/null || echo ''",
          { encoding: "utf-8", timeout: 3000 },
        ).trim();
        if (found) systemChromium = found;
      } catch { /* ignore */ }

      const { chromium } = await import("playwright");
      const launchOpts: Parameters<typeof chromium.launch>[0] = {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        ...(systemChromium ? { executablePath: systemChromium } : {}),
      };
      const browser = await Promise.race([
        chromium.launch(launchOpts),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 10000)),
      ]) as import("playwright").Browser;
      await browser.close();
      playwrightReady = true;
    } catch {
      // Playwright not available or failed to launch — report as not ready
    }

    const healthy = hasCredentials && playwrightReady;
    const reason = !hasCredentials
      ? "ACCESS_EMAIL / ACCESS_PASSWORD not configured"
      : !playwrightReady
      ? "Browser automation engine is not ready"
      : undefined;

    res.json({
      healthy,
      reason,
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
      hasDefaultConfig: !!DEFAULT_BRANCH_PP_CONFIGS[branchId],
      hasEnvConfig: !!getBranchPPConfig(branchId),
      hasOverride: branchConfigOverrides.has(branchId),
    });
  });

  // PUT /api/pp/config — update branch config override (admin only)
  app.put("/api/pp/config", requireAuth, requireRoleAtLeast("admin"), (req, res) => {
    const { branchId, branchUrl, plannerArea } = req.body as {
      branchId?: string;
      branchUrl?: string;
      plannerArea?: string;
    };

    if (!branchId) {
      return res.status(400).json({ error: "branchId is required" });
    }

    const existing = branchConfigOverrides.get(branchId) ?? {};
    const updated: Partial<BranchPPConfig> = {
      ...existing,
      ...(branchUrl !== undefined ? { branchUrl } : {}),
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

  // GET /api/pp/sessions — list recent automation sessions (run-level, not individual jobs)
  app.get("/api/pp/sessions", requireAuth, (req, res) => {
    const branchId = req.query.branchId as string | undefined;
    let sessions = listSessions();

    if (isAdmin(req)) {
      if (branchId) sessions = sessions.filter(s => s.branchId === branchId);
    } else {
      sessions = sessions.filter(s => s.initiatedByUserId === req.session.userId);
      if (branchId) sessions = sessions.filter(s => s.branchId === branchId);
    }

    // Enrich with per-job details
    const enriched = sessions.map(s => ({
      ...s,
      jobs: s.jobIds.map(id => getJob(id)).filter(Boolean),
    }));

    res.json(enriched);
  });

  // GET /api/pp/jobs — list recent individual report jobs
  app.get("/api/pp/jobs", requireAuth, (req, res) => {
    const branchId = req.query.branchId as string | undefined;
    let jobs = listJobs();

    if (isAdmin(req)) {
      if (branchId) jobs = jobs.filter(j => j.config?.branchId === branchId);
    } else {
      // Non-admins: restrict to jobs from their own sessions
      const mySessionJobIds = new Set<string>();
      for (const s of activeSessions.values()) {
        if (s.initiatedByUserId === req.session.userId) {
          for (const id of s.jobIds) mySessionJobIds.add(id);
        }
      }
      jobs = jobs.filter(j => mySessionJobIds.has(j.id));
      if (branchId) jobs = jobs.filter(j => j.config?.branchId === branchId);
    }

    res.json(jobs);
  });

  // GET /api/pp/jobs/:jobId — single job details
  app.get("/api/pp/jobs/:jobId", requireAuth, (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (!isAdmin(req)) {
      const ownsJob = Array.from(activeSessions.values()).some(
        s => s.initiatedByUserId === req.session.userId && s.jobIds.includes(job.id)
      );
      if (!ownsJob) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    res.json(job);
  });

  // GET /api/pp/download/:jobId — download a single exported file
  app.get("/api/pp/download/:jobId", requireAuth, (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job || !job.downloadReady || !job.fileName) {
      return res.status(404).json({ error: "No download available for this job" });
    }

    if (!isAdmin(req)) {
      const ownsJob = Array.from(activeSessions.values()).some(
        s => s.initiatedByUserId === req.session.userId && s.jobIds.includes(job.id)
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
      if (err) logger.error("Error sending download file", err instanceof Error ? err : undefined, { jobId: req.params.jobId });
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
          error: `No Access Workspace URL configured for branch "${branch.displayName}" (ID: ${requestedBranchId}). Contact support to add this branch to the configuration.`,
        });
      }

      // ── Global server lock: only one PP sync at a time ───────────────────────
      // There is one shared browser + one login account. Any running session
      // blocks ALL branches — not just the same branch. Reject with a realistic
      // wait estimate so users know when to retry.
      const activeSession = getAnyRunningSession();
      if (activeSession) {
        const retryAfterMinutes = estimateRetryMinutes();
        // Look up the display name of the branch that is currently syncing
        const activeBranchId = activeSession.branchId;
        const activeBranch = activeBranchId ? await storage.getBranchById(activeBranchId).catch(() => null) : null;
        const activeBranchName = activeBranch?.displayName ?? "another branch";

        logger.info("PP sync rejected — server already processing", {
          requestedBranchId,
          activeBranchId,
          activeBranchName,
          sessionId: activeSession.sessionId,
          retryAfterMinutes,
        });
        return res.status(429).json({
          error: `The server is currently syncing ${activeBranchName}. Only one sync can run at a time. Please retry in approximately ${retryAfterMinutes} minutes.`,
          retryAfterMinutes,
          activeBranchName,
          sessionId: activeSession.sessionId,
        });
      }

      const startDate = new Date(weekStartDate);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      const fmt = (d: Date) => d.toISOString().split("T")[0];

      const reportTypes = ["visitsExport", "careGiverExport", "careGiverAvailabilityExport"] as const;

      const sessionId = `ppsession_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const initiatedByUserId = req.session.userId ?? "unknown";

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
        logger.error("Pipeline session failed outside handler", err instanceof Error ? err : undefined, { sessionId });
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
      logger.error("Error starting People Planner run", error instanceof Error ? error : undefined);
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
        branchUrl: ppConfig.branchUrl,
        plannerArea: ppConfig.plannerArea,
        startDate,
        endDate,
        reportType,
        exportType: "Excel",
        exportTemplate,
        selectAllCareGivers: reportType === "careGiverAvailabilityExport",
        branchId,
      };

      const jobId = await runAutomationJob(config);
      session.jobIds.push(jobId);
      activeSessions.set(sessionId, session);

      const completedJob = await waitForJob(jobId, 1800000);

      if (completedJob.status === "failed") {
        throw new Error(`${reportType} download failed: ${completedJob.error}`);
      }

      const filePath = completedJob.filePath ?? getDownloadPath(jobId);
      if (!filePath || !fs.existsSync(filePath)) {
        throw new Error(`Downloaded file not found on disk for ${reportType}`);
      }

      downloadedBuffers[templateMap.fieldName] = fs.readFileSync(filePath);
      logger.info("File buffered", { reportType, fieldName: templateMap.fieldName, bytes: downloadedBuffers[templateMap.fieldName].length });
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
      { ghWorkbookBuffer: guaranteedBuf, branchId, guaranteedRaw: parsedData.guaranteedRaw }
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
      logger.warn("Failed to persist GH buffer to DB (non-fatal)", { err });
    }

    await storage.clearAllVisits(branchId);

    try {
      const { extractEmployeeVisitsFromGHExcel } = await import("../../features/imports/excel-visit-extractor");
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
      logger.warn("Failed to persist CP visits (non-fatal)", { err });
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

    logger.info("Automation pipeline session completed", { sessionId, branchId });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    session.status     = "failed";
    session.error      = message;
    session.phase      = "error";
    session.completedAt = new Date().toISOString();
    activeSessions.set(sessionId, session);
    logger.error("Pipeline session failed", err instanceof Error ? err : undefined, { sessionId });
    throw err;
  }
}
