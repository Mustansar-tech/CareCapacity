import type { Express } from "express";
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
interface BranchPPConfig {
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

// ─── Report type → pipeline file name mapping ────────────────────────────────
const REPORT_TEMPLATE_MAP: Record<string, { fieldName: string; pipelineFileName: string }> = {
  visitsExport: {
    fieldName: "guaranteed",
    pipelineFileName: "Care Pro Guaranteed Hours.xlsx",
  },
  careGiverExport: {
    fieldName: "cgData",
    pipelineFileName: "CG Data Export.xlsx",
  },
  careGiverAvailabilityExport: {
    fieldName: "availability",
    pipelineFileName: "Availability Export.xlsx",
  },
};

// ─── Export template names ────────────────────────────────────────────────────
const REPORT_EXPORT_TEMPLATES: Record<string, string> = {
  visitsExport: "Care Pro Guaranteed Hours",
  careGiverExport: "CG Data Export",
  careGiverAvailabilityExport: "CG Availability Export",
};

// ─── Shared export buffer (updated after automation completes) ────────────────
let latestAutomationExportBuffer: Buffer | null = null;

export function getAutomationExportBuffer(): Buffer | null {
  return latestAutomationExportBuffer;
}

// ─── Register routes ──────────────────────────────────────────────────────────
export function registerPeoplePlannerRoutes(app: Express): void {
  // GET /api/pp/health — check automation is configured and usable
  app.get("/api/pp/health", requireAuth, (req, res) => {
    const hasCredentials = !!(process.env.ACCESS_EMAIL && process.env.ACCESS_PASSWORD);
    const branchId = (req as any).session?.userId
      ? null
      : null;
    res.json({
      enabled: hasCredentials,
      credentialsConfigured: hasCredentials,
      branchConfigured: !!process.env.PEOPLE_PLANNER_BRANCH_CONFIG,
    });
  });

  // GET /api/pp/status — current running job status
  app.get("/api/pp/status", requireAuth, (_req, res) => {
    res.json({
      isRunning: isRunning(),
      currentJob: getCurrentJob() ?? null,
    });
  });

  // GET /api/pp/jobs — list recent jobs
  app.get("/api/pp/jobs", requireAuth, (_req, res) => {
    res.json(listJobs());
  });

  // GET /api/pp/jobs/:jobId — single job details
  app.get("/api/pp/jobs/:jobId", requireAuth, (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) {
      return res.status(404).json({ error: "Job not found" });
    }
    res.json(job);
  });

  // GET /api/pp/download/:jobId — download a single exported file
  app.get("/api/pp/download/:jobId", requireAuth, (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job || !job.downloadReady || !job.fileName) {
      return res.status(404).json({ error: "No download available for this job" });
    }
    const filePath = getDownloadPath(req.params.jobId);
    if (!filePath) {
      return res.status(404).json({ error: "File not found on disk" });
    }
    res.download(filePath, job.fileName, (err) => {
      if (err) logger.error({ err, jobId: req.params.jobId }, "Error sending download file");
    });
  });

  // POST /api/pp/trigger — run all 3 reports and feed into pipeline
  app.post("/api/pp/trigger", requireAuth, requireRoleAtLeast("scheduler"), async (req, res) => {
    try {
      const { weekStartDate, branchId: requestedBranchId } = req.body as {
        weekStartDate: string;
        branchId: string;
      };

      if (!weekStartDate || !requestedBranchId) {
        return res.status(400).json({ error: "weekStartDate and branchId are required" });
      }

      // Validate branch exists
      const branch = await storage.getBranchById(requestedBranchId);
      if (!branch) {
        return res.status(400).json({ error: "Invalid branch" });
      }

      // Get People Planner config for this branch
      const ppConfig = getBranchPPConfig(requestedBranchId);
      if (!ppConfig) {
        return res.status(400).json({
          error: `No People Planner configuration found for branch "${branch.displayName}". Please set PEOPLE_PLANNER_BRANCH_CONFIG in environment secrets.`,
        });
      }

      if (!process.env.ACCESS_EMAIL || !process.env.ACCESS_PASSWORD) {
        return res.status(400).json({
          error: "People Planner credentials not configured. Please set ACCESS_EMAIL and ACCESS_PASSWORD in environment secrets.",
        });
      }

      // Calculate week end date (Mon–Sun)
      const startDate = new Date(weekStartDate);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);

      const formatDate = (d: Date) => d.toISOString().split("T")[0]; // YYYY-MM-DD for engine

      const reportTypes = ["visitsExport", "careGiverExport", "careGiverAvailabilityExport"] as const;

      // Return immediately with a session ID — client polls /api/pp/session/:sessionId
      const sessionId = `ppsession_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      // Run asynchronously
      runPipelineSession(sessionId, requestedBranchId, branch.displayName, ppConfig, formatDate(startDate), formatDate(endDate), reportTypes)
        .catch(err => {
          logger.error({ sessionId, err }, "People Planner pipeline session failed");
          activeSessions.set(sessionId, {
            sessionId,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
            jobIds: [],
            phase: "error",
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
          });
        });

      return res.status(202).json({ sessionId });

    } catch (error) {
      logger.error({ error }, "Error starting People Planner trigger");
      return res.status(500).json({ error: "Failed to start automation" });
    }
  });

  // GET /api/pp/session/:sessionId — poll session status
  app.get("/api/pp/session/:sessionId", requireAuth, (req, res) => {
    const session = activeSessions.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    // Enrich with per-job details
    const jobs = session.jobIds.map(id => getJob(id)).filter(Boolean);
    res.json({ ...session, jobs });
  });
}

// ─── Session tracking ─────────────────────────────────────────────────────────
interface PipelineSession {
  sessionId: string;
  status: "running" | "completed" | "failed";
  error?: string;
  jobIds: string[];
  phase: string;
  startedAt: string;
  completedAt?: string;
  branchId?: string;
  result?: unknown;
}

const activeSessions = new Map<string, PipelineSession>();

async function runPipelineSession(
  sessionId: string,
  branchId: string,
  branchDisplayName: string,
  ppConfig: BranchPPConfig,
  startDate: string,
  endDate: string,
  reportTypes: readonly ("visitsExport" | "careGiverExport" | "careGiverAvailabilityExport")[]
): Promise<void> {
  const session: PipelineSession = {
    sessionId,
    status: "running",
    jobIds: [],
    phase: "starting",
    startedAt: new Date().toISOString(),
    branchId,
  };
  activeSessions.set(sessionId, session);

  try {
    const downloadedBuffers: Record<string, Buffer> = {};

    // Run each report type sequentially
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
      logger.info({ reportType, fieldName: templateMap.fieldName, bytes: downloadedBuffers[templateMap.fieldName].length }, "File downloaded and buffered");
    }

    // Feed into pipeline
    session.phase = "processing";
    activeSessions.set(sessionId, session);

    const availabilityBuf = downloadedBuffers["availability"];
    const guaranteedBuf = downloadedBuffers["guaranteed"];
    const cgDataBuf = downloadedBuffers["cgData"];

    if (!availabilityBuf || !guaranteedBuf || !cgDataBuf) {
      throw new Error("One or more downloaded files are missing");
    }

    logger.info({ branchId, branchDisplayName }, "Starting pipeline processing from automation data");

    const parsedData = await parseExcelFiles(
      availabilityBuf,
      guaranteedBuf,
      cgDataBuf,
      undefined,
      branchId
    );

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

    const cleanedRecords = result.cleanedRecords;
    const exportBuffer = await generateExcelExport(result, cleanedRecords, parsedData.cgData);

    latestAutomationExportBuffer = exportBuffer;

    // Write to disk (same file as manual upload uses)
    const exportPath = path.join(process.cwd(), "capacity_dashboard.xlsx");
    fs.writeFileSync(exportPath, exportBuffer);

    // Persist guaranteed hours buffer to DB
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

    // Clear old visits
    await storage.clearAllVisits(branchId);

    // Persist CP scheduled visits
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
                clientLat: entry.lat != null ? String(entry.lat) : null,
                clientLng: entry.lng != null ? String(entry.lng) : null,
                clientPostcode: entry.postcode ?? null,
                date,
                startTime: entry.startTime,
                endTime: entry.endTime,
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

    // Persist analysis to database
    if (result.dailySummary && result.dailySummary.length > 0) {
      const firstDate = result.dailySummary[0].date;
      const { weekStart, weekEnd } = getCanonicalWeekBoundaries(firstDate);

      await storage.saveCapacityAnalysis({
        branchId,
        weekStartDate: weekStart,
        weekEndDate: weekEnd,
        kpis: result.kpis,
        dailySummary: result.dailySummary,
        employeesByDate: result.employeesByDate,
        employeeSummaryByDate: result.employeeSummaryByDate || {},
        warnings: result.warnings || [],
      });

      logger.info({ branchId, weekStart }, "Automation pipeline complete — analysis persisted");
    }

    session.status = "completed";
    session.phase = "complete";
    session.completedAt = new Date().toISOString();
    session.result = { kpis: result.kpis, warnings: result.warnings };
    activeSessions.set(sessionId, session);

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    session.status = "failed";
    session.error = message;
    session.phase = "error";
    session.completedAt = new Date().toISOString();
    activeSessions.set(sessionId, session);
    logger.error({ sessionId, err }, "Pipeline session failed");
    throw err;
  }
}
