import type { Express, Request } from "express";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { requireAuth, requireRoleAtLeast } from "../../features/auth/auth";
import { storage } from "../../storage";
import { logger } from "../../infrastructure/logger";
import * as hrRepo from "../../repositories/hr.repository";
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
  getSlotCount,
  MAX_ACCOUNT_SLOTS,
  resetSlotForNextSession,
  type JobConfig,
} from "./automation-engine";
import { parseFinancialSummaryWorkbook } from "./financial-summary-parser";
import { upsertAutomatedEntry } from "../../repositories/day-rate.repository";
import { recordAutomationJobResult } from "../../repositories/day-rate-automation.repository";

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

// ─── Session tracking ─────────────────────────────────────────────────────────
interface QueuedRunParams {
  ppConfig: BranchPPConfig;
  startDate: string;
  endDate: string;
  branchDisplayName: string;
  reportTypes: readonly ("visitsExport" | "careGiverExport" | "careGiverAvailabilityExport")[];
  /** Multi-week mode: list of Monday dates to process in one session */
  weekStartDates?: string[];
  isMultiWeek?: boolean;
}

export interface WeekProgress {
  weekStartDate: string;
  weekEndDate: string;
  status: "pending" | "downloading" | "processing" | "completed" | "failed";
  error?: string;
}

interface PipelineSession {
  sessionId: string;
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
  jobIds: string[];
  phase: string;
  startedAt: string;
  completedAt?: string;
  branchId: string;
  initiatedByUserId?: string;
  result?: unknown;
  pendingParams?: QueuedRunParams;
  /** 0-based index into the account pool slot array assigned to this session */
  slotArrayIndex?: number;
  /** Per-week progress for multi-week sessions */
  weeklyProgress?: WeekProgress[];
}

const activeSessions = new Map<string, PipelineSession>();

/** FIFO queue of sessionIds waiting to start. */
const sessionQueue: string[] = [];

// ─── Branch → preferred account slot mapping ─────────────────────────────────
// Each Access Workspace account only has permission to access specific branches.
// This map routes each branch to the slot whose credentials have access to it.
// Slot 0 (ACCESS_EMAIL) is a universal fallback with access to all branches.
//
// Slot index (0-based) → env var → branches covered:
//   0 : ACCESS_EMAIL   — all branches (fallback)
//   1 : ACCESS_EMAIL_1 — Glasgow North
//   2 : ACCESS_EMAIL_2 — Aberdeen, West Fife / Dunfermline
//   3 : ACCESS_EMAIL_3 — Ayr & Kilmarnock, East Lothian & Midlothian, Scottish Borders
//   4 : ACCESS_EMAIL_4 — North Lanarkshire, Glasgow South
//   5 : ACCESS_EMAIL_5 — Stirling & Falkirk, Perth
const BRANCH_SLOT_MAP: Record<string, number> = {
  // Slot 1 — Glasgow North (ACCESS_EMAIL_1)
  "2f706320-5585-4e3c-8eb2-6c624acd7fca": 1, // Glasgow North

  // Slot 2 — Aberdeen & West Fife (ACCESS_EMAIL_2)
  "0d087ea2-68ed-45f3-9738-85de38d4ec9e": 2, // Aberdeen
  "7b10cb7c-5b1a-4f0a-bce2-d82cc23427d4": 2, // West Fife / Dunfermline

  // Slot 3 — Ayr, East Lothian & Scottish Borders (ACCESS_EMAIL_3)
  "7bc2f2fe-c0e4-4b55-b32b-04954f4f86a7": 3, // Ayr & Kilmarnock
  "b661f59b-750f-4d75-9343-31bdc3fd9c60": 3, // East Lothian & Midlothian
  "2587f931-4a8c-4afd-bedf-6621ba55f0b4": 3, // Scottish Borders

  // Slot 4 — North Lanarkshire & Glasgow South (ACCESS_EMAIL_4)
  "c812f593-9ec6-4a18-b48e-c847cc2eac81": 4, // North Lanarkshire
  "d3859b52-cfbb-4c23-b94a-4ca4f5351d65": 4, // Glasgow South

  // Slot 5 — Stirling & Perth (ACCESS_EMAIL_5)
  "311ed83e-0715-4a83-9cdf-ca6b7792b624": 5, // Stirling & Falkirk
  "92a144e1-b9d5-4ec6-b6fb-e8269ddf521d": 5, // Perth / Perthshire
};

// ─── Session-level slot reservation ──────────────────────────────────────────
// This map is the single source of truth for slot occupancy in the routing layer.
// It is updated synchronously (before any async work starts and only after it
// finishes), so there is no window where two callers can pick the same idle slot.
//
// The engine's per-job currentJobId is kept for engine-internal use only
// (logging, cleanup) and is NOT used for routing decisions here.

/** Maps 0-based slot array index → sessionId currently occupying it. */
const slotReservations = new Map<number, string>();

/** Atomically reserve a slot for a session. Must be called synchronously before launching async work. */
function reserveSlot(slotIndex: number, sessionId: string): void {
  slotReservations.set(slotIndex, sessionId);
}

/** Release a slot when a session completes or fails. */
function releaseSlot(slotIndex: number): void {
  slotReservations.delete(slotIndex);
}

/**
 * Returns the 0-based index of the best available slot for a branch, or -1 when no
 * slot is free and the session should queue.
 *
 * Selection order:
 *   1. Preferred slot from BRANCH_SLOT_MAP (if configured and idle).
 *   2. Slot 0 (ACCESS_EMAIL — universal fallback, access to all branches).
 *   3. -1 — queue; both the preferred slot and the fallback are busy.
 *
 * Uses the route-level reservation map so the result is valid throughout the
 * synchronous dispatch path (no async gaps between check and reserve).
 */
function findPreferredSlotForBranch(branchId: string): number {
  const preferred = BRANCH_SLOT_MAP[branchId];
  // Try preferred slot first (must exist in the loaded pool)
  if (preferred !== undefined && preferred < getSlotCount() && !slotReservations.has(preferred)) {
    return preferred;
  }
  // Fall back to slot 0 (ACCESS_EMAIL — all branches)
  if (!slotReservations.has(0)) {
    return 0;
  }
  // Both are busy — caller should queue
  return -1;
}

/** True when every account slot is occupied by a running session. */
function allSlotsBusy(): boolean {
  return slotReservations.size >= getSlotCount();
}

/**
 * Build the slot status array for the health endpoint.
 * Reports session-level occupancy rather than per-job engine state.
 */
function routeSlotStatus(): Array<{ index: number; busy: boolean; currentSessionId: string | null }> {
  const total = getSlotCount();
  return Array.from({ length: total }, (_, i) => ({
    index: i + 1,                             // 1-based slot number matching engine display index
    busy: slotReservations.has(i),
    currentSessionId: slotReservations.get(i) ?? null,
  }));
}

/** Returns queue position (1-based). Running sessions are position 1; queued sessions are 2+. */
function getQueuePos(sessionId: string): number {
  if (activeSessions.get(sessionId)?.status === "running") return 1;
  const idx = sessionQueue.indexOf(sessionId);
  const runningCount = slotReservations.size;
  return idx === -1 ? 1 : runningCount + idx + 1;
}

/**
 * Called after any session finishes. Drains the FIFO queue across all idle slots —
 * up to one queued session per idle slot is started on each call.
 * Slot reservation happens synchronously inside the while loop before any async work
 * begins, preventing two iterations from picking the same slot.
 */
function startNextQueuedSession(): void {
  while (sessionQueue.length > 0) {
    // Peek at the next queued session to choose its preferred slot before shifting
    const peekId = sessionQueue[0];
    const peekSession = activeSessions.get(peekId);
    const idleSlot = peekSession
      ? findPreferredSlotForBranch(peekSession.branchId)
      : -1;
    if (idleSlot === -1) return; // no suitable slot free — stop draining

    const nextId = sessionQueue.shift()!;
    const session = activeSessions.get(nextId);
    if (!session?.pendingParams) {
      logger.warn("Queued session missing or has no params — skipping", { nextId });
      continue; // skip and try the next one in the queue
    }

    // Reserve the slot synchronously before launching any async work.
    reserveSlot(idleSlot, nextId);

    const params = session.pendingParams;
    session.status = "running";
    session.phase = "starting";
    session.slotArrayIndex = idleSlot;
    session.pendingParams = undefined;
    activeSessions.set(nextId, session);

    logger.info("Auto-starting next queued session", {
      sessionId: nextId,
      branchId: session.branchId,
      slotArrayIndex: idleSlot,
      isMultiWeek: params.isMultiWeek,
      remaining: sessionQueue.length,
    });

    const runner = params.isMultiWeek && params.weekStartDates && params.weekStartDates.length > 0
      ? runMultiWeekPipelineSession(
          nextId, session.branchId, params.branchDisplayName, params.ppConfig,
          params.weekStartDates, session.initiatedByUserId ?? "unknown", idleSlot
        )
      : runPipelineSession(
          nextId, session.branchId, params.branchDisplayName, params.ppConfig,
          params.startDate, params.endDate, params.reportTypes,
          session.initiatedByUserId ?? "unknown", idleSlot
        );

    runner.catch(err => {
      const s = activeSessions.get(nextId);
      if (s && s.status === "running") {
        activeSessions.set(nextId, { ...s, status: "failed", error: err instanceof Error ? err.message : String(err), phase: "error", completedAt: new Date().toISOString() });
      }
      logger.error("Queued pipeline session failed", err instanceof Error ? err : undefined, { sessionId: nextId });
    }).finally(() => {
      releaseSlot(idleSlot);
      setImmediate(() => startNextQueuedSession());
    });
  }
}

// ─── Day Rate Tracker — Financial Summary automation ─────────────────────────
// Maps a day_rate_franchises "office" name to the branch whose People Planner
// instance owns it (branches share PP tenants exactly like DEFAULT_BRANCH_PP_CONFIGS above).
const DAY_RATE_OFFICE_TO_BRANCH: Record<string, string> = {
  "Glasgow North":   "2f706320-5585-4e3c-8eb2-6c624acd7fca",
  "North Lan":       "c812f593-9ec6-4a18-b48e-c847cc2eac81",
  "Glasgow South":   "d3859b52-cfbb-4c23-b94a-4ca4f5351d65",
  "Aberdeen":        "0d087ea2-68ed-45f3-9738-85de38d4ec9e",
  "Perthshire":      "92a144e1-b9d5-4ec6-b6fb-e8269ddf521d",
  "South Ayrshire":  "7bc2f2fe-c0e4-4b55-b32b-04954f4f86a7",
  "Stirling":        "311ed83e-0715-4a83-9cdf-ca6b7792b624",
  "East Lothian":    "b661f59b-750f-4d75-9343-31bdc3fd9c60",
  "Scottish Borders": "2587f931-4a8c-4afd-bedf-6621ba55f0b4",
  "West Fife":       "7b10cb7c-5b1a-4f0a-bce2-d82cc23427d4",
};

export function getBranchIdForDayRateOffice(office: string): string | null {
  return DAY_RATE_OFFICE_TO_BRANCH[office] ?? null;
}

export interface FinancialSummaryJobSpec {
  franchiseId: string;
  financeFranchiseName: string;
  /** Calendar date (YYYY-MM-DD) this reading is recorded against */
  date: string;
  /** YYYY-MM reporting period the export covers */
  reportingMonth: string;
  daysInMonth: number;
  /** Full-month export range (YYYY-MM-DD) */
  startDate: string;
  endDate: string;
}

interface FinancialSummaryJobResult {
  franchiseName: string;
  reportingMonth: string;
  status: "running" | "completed" | "failed";
  revenue?: number;
  error?: string;
}

interface FinancialSummarySession {
  sessionId: string;
  status: "queued" | "running" | "completed" | "failed";
  error?: string;
  branchId: string;
  initiatedByUserId: string;
  startedAt: string;
  completedAt?: string;
  jobResults: FinancialSummaryJobResult[];
  pendingJobs?: FinancialSummaryJobSpec[];
  slotArrayIndex?: number;
  /** Persisted automation-run row this session's job results are recorded against. */
  runId?: string;
}

/** Transient automation errors worth retrying — login/launcher flakiness, not business-logic failures. */
const RETRYABLE_JOB_ERROR_PATTERNS = [
  /timeout/i,
  /tile not found/i,
  /net::ERR_/i,
  /no file download detected/i,
  /frame was detached/i,
  /still on login page/i,
  /launcher iframe/i,
];

function isRetryableJobError(message: string): boolean {
  return RETRYABLE_JOB_ERROR_PATTERNS.some(p => p.test(message));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const financialSummarySessions = new Map<string, FinancialSummarySession>();
const financialSummaryQueue: string[] = [];

interface DayRateAutomationStatus {
  enabled: boolean;
  lastRunAt: string | null;
  lastRunSessionIds: string[];
  lastRunSummary: { total: number; completed: number; failed: number } | null;
  lastErrors: { branchId: string; franchiseName: string; reportingMonth: string; error: string }[];
}

let dayRateAutomationStatus: DayRateAutomationStatus = {
  enabled: false,
  lastRunAt: null,
  lastRunSessionIds: [],
  lastRunSummary: null,
  lastErrors: [],
};

export function updateDayRateAutomationStatus(update: Partial<DayRateAutomationStatus>): void {
  dayRateAutomationStatus = { ...dayRateAutomationStatus, ...update };
}

export function getDayRateAutomationStatus(): DayRateAutomationStatus {
  return { ...dayRateAutomationStatus };
}

export function listFinancialSummarySessions(): FinancialSummarySession[] {
  return Array.from(financialSummarySessions.values())
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 30);
}

async function runFinancialSummarySession(
  sessionId: string,
  branchId: string,
  jobs: FinancialSummaryJobSpec[],
  initiatedByUserId: string,
  slotArrayIndex: number,
  runId?: string,
): Promise<void> {
  const ppConfig = getMergedBranchConfig(branchId);
  if (!ppConfig) throw new Error(`No People Planner config for branch ${branchId}`);

  const existing = financialSummarySessions.get(sessionId);
  const session: FinancialSummarySession = existing
    ? { ...existing, status: "running", jobResults: [], pendingJobs: undefined, runId: existing.runId ?? runId }
    : { sessionId, status: "running", branchId, initiatedByUserId, startedAt: new Date().toISOString(), jobResults: [], runId };
  financialSummarySessions.set(sessionId, session);

  const MAX_ATTEMPTS = 3; // 1 initial + 2 retries — covers the common cold-login timeout flakiness

  try {
    await resetSlotForNextSession(slotArrayIndex);

    for (const job of jobs) {
      const jobResult: FinancialSummaryJobResult = {
        franchiseName: job.financeFranchiseName,
        reportingMonth: job.reportingMonth,
        status: "running",
      };
      session.jobResults.push(jobResult);
      financialSummarySessions.set(sessionId, session);

      let attempt = 0;
      let lastError: string | undefined;

      while (attempt < MAX_ATTEMPTS) {
        attempt++;
        try {
          const config: JobConfig = {
            branchUrl: ppConfig.branchUrl,
            startDate: job.startDate,
            endDate: job.endDate,
            reportType: "financialSummaryExport",
            exportType: "",
            exportTemplate: "",
            financeFranchiseName: job.financeFranchiseName,
            careGiverType: "Summary",
            careGiverStatus: "All",
            branchId,
          };

          const jobId = await runAutomationJob(config, slotArrayIndex);
          const completedJob = await waitForJob(jobId, 600000);

          if (completedJob.status === "failed") {
            throw new Error(completedJob.error || "Financial Summary download failed");
          }

          const filePath = completedJob.filePath ?? getDownloadPath(jobId);
          if (!filePath || !fs.existsSync(filePath)) {
            throw new Error("Downloaded Financial Summary file not found on disk");
          }

          const buffer = fs.readFileSync(filePath);
          const totals = await parseFinancialSummaryWorkbook(buffer);

          await upsertAutomatedEntry({
            franchiseId: job.franchiseId,
            date: job.date,
            reportingMonth: job.reportingMonth,
            daysInMonth: job.daysInMonth,
            revenue: totals.revenue,
          });

          jobResult.status = "completed";
          jobResult.revenue = totals.revenue;
          logger.info("Financial Summary job completed", {
            branchId, franchiseName: job.financeFranchiseName, reportingMonth: job.reportingMonth,
            revenue: totals.revenue, attempt,
          });
          lastError = undefined;
          break;
        } catch (jobErr) {
          lastError = jobErr instanceof Error ? jobErr.message : String(jobErr);
          const willRetry = attempt < MAX_ATTEMPTS && isRetryableJobError(lastError);
          logger.error(willRetry ? "Financial Summary job failed — will retry" : "Financial Summary job failed", jobErr instanceof Error ? jobErr : undefined, {
            branchId, franchiseName: job.financeFranchiseName, reportingMonth: job.reportingMonth, attempt, willRetry,
          });
          if (!willRetry) break;
          // Give the launcher/login flow a moment to recover before trying again —
          // most failures at this point are transient AccessCloud login/launcher timeouts.
          await sleep(8000);
        }
      }

      if (lastError) {
        jobResult.status = "failed";
        jobResult.error = lastError;
        // Continue with remaining franchises/months rather than aborting the whole session.
      }
      financialSummarySessions.set(sessionId, session);

      if (session.runId) {
        recordAutomationJobResult({
          runId: session.runId,
          branchId,
          franchiseName: job.financeFranchiseName,
          reportingMonth: job.reportingMonth,
          status: jobResult.status === "completed" ? "completed" : "failed",
          revenue: jobResult.revenue,
          error: jobResult.error,
          attempts: attempt,
        }).catch(err => logger.error("Failed to persist automation job result", err instanceof Error ? err : undefined));
      }
    }

    session.status = "completed";
    session.completedAt = new Date().toISOString();
    financialSummarySessions.set(sessionId, session);
  } catch (err) {
    session.status = "failed";
    session.error = err instanceof Error ? err.message : String(err);
    session.completedAt = new Date().toISOString();
    financialSummarySessions.set(sessionId, session);
    logger.error("Financial Summary session failed", err instanceof Error ? err : undefined, { sessionId, branchId });
    throw err;
  }
}

function startNextQueuedFinancialSummarySession(): void {
  while (financialSummaryQueue.length > 0) {
    const peekId = financialSummaryQueue[0];
    const peekSession = financialSummarySessions.get(peekId);
    const idleSlot = peekSession ? findPreferredSlotForBranch(peekSession.branchId) : -1;
    if (idleSlot === -1) return;

    const nextId = financialSummaryQueue.shift()!;
    const session = financialSummarySessions.get(nextId);
    if (!session?.pendingJobs) {
      logger.warn("Queued financial summary session missing or has no jobs — skipping", { nextId });
      continue;
    }

    reserveSlot(idleSlot, nextId);
    const jobs = session.pendingJobs;
    session.status = "running";
    session.slotArrayIndex = idleSlot;
    session.pendingJobs = undefined;
    financialSummarySessions.set(nextId, session);

    runFinancialSummarySession(nextId, session.branchId, jobs, session.initiatedByUserId, idleSlot, session.runId)
      .catch(err => {
        const s = financialSummarySessions.get(nextId);
        if (s && s.status === "running") {
          financialSummarySessions.set(nextId, { ...s, status: "failed", error: err instanceof Error ? err.message : String(err), completedAt: new Date().toISOString() });
        }
        logger.error("Queued financial summary session failed", err instanceof Error ? err : undefined, { sessionId: nextId });
      })
      .finally(() => {
        releaseSlot(idleSlot);
        setImmediate(() => {
          startNextQueuedFinancialSummarySession();
          startNextQueuedSession();
        });
      });
  }
}

/**
 * Programmatically queue a Financial Summary automation run for one branch's set of
 * franchise/month jobs — same slot-reservation machinery as the weekly capacity sync,
 * so the two automations never contend for the same Playwright account slot.
 */
export async function programmaticQueueFinancialSummarySync(
  branchId: string,
  jobs: FinancialSummaryJobSpec[],
  initiatedByUserId: string,
  runId?: string,
): Promise<{ sessionId: string; queued: boolean; queuePosition?: number }> {
  const ppConfig = getMergedBranchConfig(branchId);
  if (!ppConfig) throw new Error(`No People Planner config for branch ${branchId}`);
  if (jobs.length === 0) throw new Error("No Financial Summary jobs provided");

  const sessionId = `fs-${branchId}-${Date.now()}`;
  const idleSlot = findPreferredSlotForBranch(branchId);

  if (idleSlot === -1) {
    const pendingSession: FinancialSummarySession = {
      sessionId, status: "queued", branchId, initiatedByUserId,
      startedAt: new Date().toISOString(), jobResults: [], pendingJobs: jobs, runId,
    };
    financialSummarySessions.set(sessionId, pendingSession);
    financialSummaryQueue.push(sessionId);
    return { sessionId, queued: true, queuePosition: financialSummaryQueue.length };
  }

  reserveSlot(idleSlot, sessionId);
  const newSession: FinancialSummarySession = {
    sessionId, status: "running", branchId, initiatedByUserId,
    startedAt: new Date().toISOString(), jobResults: [], slotArrayIndex: idleSlot, runId,
  };
  financialSummarySessions.set(sessionId, newSession);

  runFinancialSummarySession(sessionId, branchId, jobs, initiatedByUserId, idleSlot)
    .catch(err => {
      const s = financialSummarySessions.get(sessionId);
      if (s && s.status === "running") {
        financialSummarySessions.set(sessionId, { ...s, status: "failed", error: err instanceof Error ? err.message : String(err), completedAt: new Date().toISOString() });
      }
    })
    .finally(() => {
      releaseSlot(idleSlot);
      setImmediate(() => {
        startNextQueuedFinancialSummarySession();
        startNextQueuedSession();
      });
    });

  return { sessionId, queued: false };
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

// ─── Weekly scheduler state (updated by scheduler.ts) ────────────────────────
interface SchedulerStatus {
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunBranchIds: string[];
}

let schedulerStatus: SchedulerStatus = {
  enabled: false,
  nextRunAt: null,
  lastRunAt: null,
  lastRunBranchIds: [],
};

export function updateSchedulerStatus(update: Partial<SchedulerStatus>): void {
  schedulerStatus = { ...schedulerStatus, ...update };
}

export function getSchedulerStatus(): SchedulerStatus {
  return { ...schedulerStatus };
}

export function listSessions(): PipelineSession[] {
  return Array.from(activeSessions.values())
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 30);
}

/** Returns all branch IDs that have a built-in People Planner configuration. */
export function getConfiguredBranchIds(): string[] {
  return Object.keys(DEFAULT_BRANCH_PP_CONFIGS);
}

/**
 * Programmatically queue a sync for a branch — same logic as POST /api/pp/run
 * but usable without an HTTP request (e.g. from the weekly scheduler).
 * Returns { sessionId, queued, queuePosition }.
 */
export async function programmaticQueueSync(
  branchId: string,
  weekStartDate: string,
  initiatedByUserId = "system"
): Promise<{ sessionId: string; queued: boolean; queuePosition: number }> {
  const branch = await storage.getBranchById(branchId);
  if (!branch) throw new Error(`Branch not found: ${branchId}`);

  const ppConfig = getMergedBranchConfig(branchId);
  if (!ppConfig) throw new Error(`No PP config for branch ${branch.displayName}`);

  const startDate = new Date(weekStartDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  const fmt = (d: Date) => d.toISOString().split("T")[0];
  const reportTypes = ["visitsExport", "careGiverExport", "careGiverAvailabilityExport"] as const;
  const sessionId = `ppsession_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Check slot availability and reserve synchronously before any async work.
  const idleSlot = findPreferredSlotForBranch(branchId);
  if (idleSlot === -1) {
    const pendingSession: PipelineSession = {
      sessionId,
      status: "queued",
      jobIds: [],
      phase: "queued",
      startedAt: new Date().toISOString(),
      branchId,
      initiatedByUserId,
      pendingParams: {
        ppConfig,
        startDate: fmt(startDate),
        endDate: fmt(endDate),
        branchDisplayName: branch.displayName,
        reportTypes,
      },
    };
    activeSessions.set(sessionId, pendingSession);
    sessionQueue.push(sessionId);
    const queuePosition = slotReservations.size + sessionQueue.length;
    logger.info("Programmatic PP sync queued — all slots busy", { sessionId, branchId, queuePosition });
    return { sessionId, queued: true, queuePosition };
  }

  // Reserve slot synchronously, then start the async pipeline.
  reserveSlot(idleSlot, sessionId);
  const newSession: PipelineSession = {
    sessionId,
    status: "running",
    jobIds: [],
    phase: "starting",
    startedAt: new Date().toISOString(),
    branchId,
    initiatedByUserId,
    slotArrayIndex: idleSlot,
  };
  activeSessions.set(sessionId, newSession);

  runPipelineSession(
    sessionId, branchId, branch.displayName, ppConfig,
    fmt(startDate), fmt(endDate), reportTypes, initiatedByUserId, idleSlot
  ).catch(err => {
    const s = activeSessions.get(sessionId);
    if (s && s.status === "running") {
      activeSessions.set(sessionId, { ...s, status: "failed", error: err instanceof Error ? err.message : String(err), phase: "error", completedAt: new Date().toISOString() });
    }
    logger.error("Programmatic pipeline session failed", err instanceof Error ? err : undefined, { sessionId });
  }).finally(() => {
    releaseSlot(idleSlot);
    setImmediate(() => startNextQueuedSession());
  });

  logger.info("Programmatic PP sync started", { sessionId, branchId, slotArrayIndex: idleSlot });
  return { sessionId, queued: false, queuePosition: 1 };
}

/**
 * Programmatically queue a multi-week sync for a branch — processes all weeks
 * in `weekStartDates` in a single Playwright session (login once, iterate, logout).
 * Returns { sessionId, queued, queuePosition }.
 */
export async function programmaticQueueMultiWeekSync(
  branchId: string,
  weekStartDates: string[],
  initiatedByUserId = "system"
): Promise<{ sessionId: string; queued: boolean; queuePosition: number }> {
  if (weekStartDates.length === 0) throw new Error("weekStartDates must not be empty");
  const branch = await storage.getBranchById(branchId);
  if (!branch) throw new Error(`Branch not found: ${branchId}`);

  const ppConfig = getMergedBranchConfig(branchId);
  if (!ppConfig) throw new Error(`No PP config for branch ${branch.displayName}`);

  const reportTypes = ["visitsExport", "careGiverExport", "careGiverAvailabilityExport"] as const;
  const sessionId = `ppsession_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // Initialise per-week progress entries.
  const weeklyProgress: WeekProgress[] = weekStartDates.map(ws => {
    const end = new Date(ws);
    end.setUTCDate(end.getUTCDate() + 6);
    return {
      weekStartDate: ws,
      weekEndDate: end.toISOString().split("T")[0],
      status: "pending",
    };
  });

  const idleSlot = findPreferredSlotForBranch(branchId);
  if (idleSlot === -1) {
    const pendingSession: PipelineSession = {
      sessionId,
      status: "queued",
      jobIds: [],
      phase: "queued",
      startedAt: new Date().toISOString(),
      branchId,
      initiatedByUserId,
      weeklyProgress,
      pendingParams: {
        ppConfig,
        startDate: weekStartDates[0],
        endDate: weeklyProgress[weeklyProgress.length - 1].weekEndDate,
        branchDisplayName: branch.displayName,
        reportTypes,
        weekStartDates,
        isMultiWeek: true,
      },
    };
    activeSessions.set(sessionId, pendingSession);
    sessionQueue.push(sessionId);
    const queuePosition = slotReservations.size + sessionQueue.length;
    logger.info("Programmatic PP multi-week sync queued — all slots busy", { sessionId, branchId, weekCount: weekStartDates.length, queuePosition });
    return { sessionId, queued: true, queuePosition };
  }

  reserveSlot(idleSlot, sessionId);
  const newSession: PipelineSession = {
    sessionId,
    status: "running",
    jobIds: [],
    phase: "starting",
    startedAt: new Date().toISOString(),
    branchId,
    initiatedByUserId,
    slotArrayIndex: idleSlot,
    weeklyProgress,
  };
  activeSessions.set(sessionId, newSession);

  runMultiWeekPipelineSession(
    sessionId, branchId, branch.displayName, ppConfig, weekStartDates, initiatedByUserId, idleSlot
  ).catch(err => {
    const s = activeSessions.get(sessionId);
    if (s && s.status === "running") {
      activeSessions.set(sessionId, { ...s, status: "failed", error: err instanceof Error ? err.message : String(err), phase: "error", completedAt: new Date().toISOString() });
    }
    logger.error("Programmatic multi-week pipeline session failed", err instanceof Error ? err : undefined, { sessionId });
  }).finally(() => {
    releaseSlot(idleSlot);
    setImmediate(() => startNextQueuedSession());
  });

  logger.info("Programmatic PP multi-week sync started", { sessionId, branchId, weekCount: weekStartDates.length, slotArrayIndex: idleSlot });
  return { sessionId, queued: false, queuePosition: 1 };
}

// ─── Register routes ──────────────────────────────────────────────────────────
export function registerPeoplePlannerRoutes(app: Express): void {
  // ── Startup diagnostics ────────────────────────────────────────────────────
  // Log the effective branch→preferred-slot mapping so operators can verify
  // that each branch is wired to the correct Access Workspace account at boot.
  const slotCount = getSlotCount();
  const mappingReport = Object.entries(BRANCH_SLOT_MAP).reduce<Record<string, { preferredSlot: number; slotConfigured: boolean }>>((acc, [bId, slot]) => {
    acc[bId] = { preferredSlot: slot, slotConfigured: slot < slotCount };
    return acc;
  }, {});
  logger.info("PP branch→slot mapping effective at startup", {
    slotCount,
    mapping: mappingReport,
    unmappedBranchesFallToSlot0: true,
  });

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
      accountCount: getSlotCount(),
      idleCount: getSlotCount() - slotReservations.size,
      slots: routeSlotStatus(),
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

      // Compute run parameters up-front (needed whether we start now or queue)
      const startDate = new Date(weekStartDate);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 6);
      const fmt = (d: Date) => d.toISOString().split("T")[0];
      const reportTypes = ["visitsExport", "careGiverExport", "careGiverAvailabilityExport"] as const;
      const sessionId = `ppsession_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const initiatedByUserId = req.session.userId ?? "unknown";

      // ── Account pool: reserve a slot synchronously or queue ──────────────
      // findPreferredSlotForBranch() + reserveSlot() both run synchronously in
      // this event-loop turn, so no two concurrent requests can pick the same slot.
      const idleSlot = findPreferredSlotForBranch(requestedBranchId);
      if (idleSlot === -1) {
        const pendingSession: PipelineSession = {
          sessionId,
          status: "queued",
          jobIds: [],
          phase: "queued",
          startedAt: new Date().toISOString(),
          branchId: requestedBranchId,
          initiatedByUserId,
          pendingParams: {
            ppConfig,
            startDate: fmt(startDate),
            endDate: fmt(endDate),
            branchDisplayName: branch.displayName,
            reportTypes,
          },
        };
        activeSessions.set(sessionId, pendingSession);
        sessionQueue.push(sessionId);
        const queuePosition = slotReservations.size + sessionQueue.length;
        logger.info("PP sync queued — all slots busy", { sessionId, branchId: requestedBranchId, queuePosition, accountSlots: slotReservations.size });
        return res.status(202).json({ sessionId, queued: true, queuePosition });
      }

      // Reserve slot synchronously before any await.
      reserveSlot(idleSlot, sessionId);
      const newSession: PipelineSession = {
        sessionId,
        status: "running",
        jobIds: [],
        phase: "starting",
        startedAt: new Date().toISOString(),
        branchId: requestedBranchId,
        initiatedByUserId,
        slotArrayIndex: idleSlot,
      };
      activeSessions.set(sessionId, newSession);

      runPipelineSession(
        sessionId,
        requestedBranchId,
        branch.displayName,
        ppConfig,
        fmt(startDate),
        fmt(endDate),
        reportTypes,
        initiatedByUserId,
        idleSlot
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
      }).finally(() => {
        releaseSlot(idleSlot);
        setImmediate(() => startNextQueuedSession());
      });

      logger.info("PP sync started", { sessionId, branchId: requestedBranchId, slotArrayIndex: idleSlot });
      return res.status(202).json({ sessionId, queued: false, queuePosition: 1 });

    } catch (error) {
      logger.error("Error starting People Planner run", error instanceof Error ? error : undefined);
      return res.status(500).json({ error: "Failed to start automation" });
    }
  });

  // GET /api/pp/active — global sync status (no branch names exposed)
  // Used by the persistent SyncStatusBar in the app header.
  app.get("/api/pp/active", requireAuth, (req, res) => {
    const userId = req.session?.userId;

    const mapSession = (s: PipelineSession, position: number) => {
      const isOwn = !!userId && s.initiatedByUserId === userId;
      return {
        sessionId: s.sessionId,
        status: s.status,
        phase: s.phase,
        startedAt: s.startedAt,
        queuePosition: position,
        isOwnSession: isOwn,
        // Only expose branchId to the owner — never to other users
        branchId: isOwn ? s.branchId : undefined,
      };
    };

    const allRunning = Array.from(activeSessions.values())
      .filter(s => s.status === "running")
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    const queued = sessionQueue
      .map(id => activeSessions.get(id))
      .filter((s): s is PipelineSession => !!s);

    res.json({
      // `running` keeps the single-value shape for backwards compatibility with SyncStatusBar
      running: allRunning.length > 0 ? mapSession(allRunning[0], 1) : null,
      // `runningAll` exposes all concurrently running sessions
      runningAll: allRunning.map(s => mapSession(s, 1)),
      queued: queued.map((s, i) => mapSession(s, allRunning.length + i + 1)),
      total: allRunning.length + queued.length,
      accountSlots: getSlotCount(),
      idleSlots: Math.max(0, getSlotCount() - allRunning.length),
    });
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

  // GET /api/pp/last-sync/:branchId — returns uploadedAt for a specific week (or latest)
  // ?weekStartDate=YYYY-MM-DD  → exact week; omit → most recent analysis
  app.get("/api/pp/last-sync/:branchId", requireAuth, async (req, res) => {
    try {
      const { branchId } = req.params;
      const weekStartDate = req.query.weekStartDate as string | undefined;

      const analysis = weekStartDate
        ? await storage.getCapacityAnalysisByWeekStart(branchId, weekStartDate)
        : await storage.getLatestCapacityAnalysis(branchId);

      if (!analysis) return res.json({ uploadedAt: null, weekStartDate: weekStartDate ?? null });
      res.json({
        uploadedAt: analysis.uploadedAt,
        weekStartDate: analysis.weekStartDate,
        weekEndDate: analysis.weekEndDate,
      });
    } catch (err) {
      logger.error("Failed to get last sync time", err instanceof Error ? err : undefined);
      res.status(500).json({ error: "Failed to get last sync time" });
    }
  });

  // GET /api/pp/scheduler/status — info about the weekly cron job
  app.get("/api/pp/scheduler/status", requireAuth, requireRoleAtLeast("admin"), (_req, res) => {
    res.json(getSchedulerStatus());
  });

  // POST /api/day-rate/automation/run — manually trigger the Financial Summary automation
  // for every tracked franchise/office (current + forward month). Admin-only; mirrors the
  // ad-hoc trigger pattern of /api/pp/run-multi-week.
  app.post("/api/day-rate/automation/run", requireAuth, requireRoleAtLeast("admin"), async (req, res) => {
    if (!process.env.ACCESS_EMAIL || !process.env.ACCESS_PASSWORD) {
      return res.status(503).json({ error: "People Planner credentials not configured." });
    }
    try {
      const { runDayRateAutomation } = await import("./day-rate-scheduler");
      const triggeredBy = req.session?.userId ? `manual:${req.session.userId}` : "manual";
      // Fire-and-forget: sessions run in the background exactly like the cron trigger;
      // status is polled via GET /api/day-rate/automation/status.
      runDayRateAutomation(new Date(), triggeredBy).catch(err => {
        logger.error("Manual day-rate automation run failed", err instanceof Error ? err : undefined);
      });
      return res.status(202).json({ started: true });
    } catch (error) {
      logger.error("Error starting day-rate automation run", error instanceof Error ? error : undefined);
      return res.status(500).json({ error: "Failed to start day-rate automation run" });
    }
  });

  // GET /api/day-rate/automation/status — Financial Summary automation health,
  // surfaced the same way the weekly People Planner sync status is (admin-only).
  //
  // Reads from the persisted day_rate_automation_runs/job_results tables rather
  // than in-process memory: the cron that actually runs this automation lives in
  // a separate PM2 process (care-capacity-worker) from the one serving this API
  // route (care-capacity-api), so in-memory-only state here would always show
  // "not yet run" for cron-triggered runs even when they completed successfully.
  app.get("/api/day-rate/automation/status", requireAuth, requireRoleAtLeast("admin"), async (_req, res) => {
    try {
      const { getLatestAutomationRun } = await import("../../repositories/day-rate-automation.repository");
      const latestRun = await getLatestAutomationRun();
      const sessions = listFinancialSummarySessions();

      if (!latestRun) {
        return res.json({
          enabled: false,
          lastRunAt: null,
          lastRunSummary: null,
          lastErrors: [],
          recentSessions: sessions,
        });
      }

      // A run still in progress (no completedAt yet) reports its live totals from
      // job results persisted so far, so the banner can show "in progress" state.
      res.json({
        enabled: true,
        lastRunAt: latestRun.startedAt,
        lastRunCompletedAt: latestRun.completedAt,
        inProgress: latestRun.completedAt === null,
        triggeredBy: latestRun.triggeredBy,
        lastRunSummary: { total: latestRun.totalJobs, completed: latestRun.completedJobs, failed: latestRun.failedJobs },
        lastErrors: latestRun.errors,
        unmappedFranchises: latestRun.unmappedFranchises,
        recentSessions: sessions,
      });
    } catch (error) {
      logger.error("Failed to read day-rate automation status", error instanceof Error ? error : undefined);
      res.status(500).json({ error: "Failed to read automation status" });
    }
  });

  // POST /api/cron/sync?label=previous|current|next — cron-job.org friendly alias
  // Secured by CRON_SECRET via standard "Authorization: Bearer <token>" header.
  // No session cookie required so sleeping autoscale instances can be woken up.
  //   label=previous → last Mon–Sun  (fired Mon 01:00 UTC)
  //   label=current  → this Mon–Sun  (fired Mon 03:00 UTC)
  //   label=next     → next Mon–Sun  (fired Mon 05:00 UTC)
  app.post("/api/cron/sync", async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return res.status(503).json({ ok: false, error: "CRON_SECRET not configured on this server" });
    }

    const authHeader = req.headers["authorization"] as string | undefined;
    const provided = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    if (!provided || provided !== secret) {
      logger.warn("Cron sync: invalid or missing bearer token", { ip: req.ip });
      return res.status(401).json({ ok: false, error: "Unauthorised" });
    }

    if (!process.env.ACCESS_EMAIL || !process.env.ACCESS_PASSWORD) {
      return res.status(503).json({ ok: false, error: "People Planner credentials not configured" });
    }

    const label = req.query.label as string | undefined;
    const OFFSETS: Record<string, number> = { previous: -7, current: 0, next: 7 };
    if (!label || !(label in OFFSETS)) {
      return res.status(400).json({ ok: false, error: "Query param label must be 'previous' | 'current' | 'next'" });
    }

    const now = new Date();
    const day = now.getUTCDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() + diffToMonday + OFFSETS[label]);
    monday.setUTCHours(0, 0, 0, 0);
    const weekStartDate = monday.toISOString().split("T")[0];

    const branchIds = getConfiguredBranchIds();
    logger.info("Cron sync triggered", { label, weekStartDate, branchIds });
    updateSchedulerStatus({ lastRunAt: new Date().toISOString(), lastRunBranchIds: branchIds });

    res.json({ ok: true, label, weekStartDate, branchIds, message: "Sync queued for all branches" });

    for (const branchId of branchIds) {
      try {
        const result = await programmaticQueueSync(branchId, weekStartDate, `cron-${label}`);
        logger.info("Cron sync queued", { branchId, label, weekStartDate, ...result });
      } catch (err) {
        logger.error("Cron sync: failed to queue branch", err instanceof Error ? err : undefined, { branchId, label });
      }
    }
  });

  // POST /api/pp/run-multi-week — sync all forward weeks for a branch in one session
  app.post("/api/pp/run-multi-week", requireAuth, requireRoleAtLeast("scheduler"), async (req, res) => {
    if (!process.env.ACCESS_EMAIL || !process.env.ACCESS_PASSWORD) {
      return res.status(503).json({ error: "People Planner credentials not configured." });
    }

    try {
      const { branchId: requestedBranchId } = req.body as { branchId: string };

      if (!requestedBranchId) {
        return res.status(400).json({ error: "branchId is required" });
      }

      const branch = await storage.getBranchById(requestedBranchId);
      if (!branch) return res.status(400).json({ error: "Invalid branch" });

      const ppConfig = getMergedBranchConfig(requestedBranchId);
      if (!ppConfig) {
        return res.status(400).json({
          error: `No Access Workspace URL configured for branch "${branch.displayName}".`,
        });
      }

      const { getWeeksToSync } = await import("./week-helpers");
      const now = new Date();
      const isMonday = now.getUTCDay() === 1;
      const weekStartDates = getWeeksToSync(now, isMonday);

      const initiatedByUserId = req.session.userId ?? "unknown";
      const result = await programmaticQueueMultiWeekSync(requestedBranchId, weekStartDates, initiatedByUserId);

      logger.info("Multi-week PP sync triggered via API", {
        branchId: requestedBranchId,
        weekCount: weekStartDates.length,
        weeks: weekStartDates,
        ...result,
      });

      return res.status(202).json({ ...result, weekCount: weekStartDates.length, weeks: weekStartDates });
    } catch (error) {
      logger.error("Error starting multi-week People Planner run", error instanceof Error ? error : undefined);
      return res.status(500).json({ error: "Failed to start multi-week sync" });
    }
  });

  // ─── Manual test trigger (admin-only) ───────────────────────────────────────
  // Fires selected Monday sync runs immediately.
  // Body: { weeks?: Array<"previous" | "current" | "next"> }  — defaults to all three.
  // POST /api/pp/trigger-weekly-sync
  app.post("/api/pp/trigger-weekly-sync", requireAuth, requireRoleAtLeast("admin"), async (req, res) => {
    if (!process.env.ACCESS_EMAIL || !process.env.ACCESS_PASSWORD) {
      return res.status(503).json({ ok: false, error: "People Planner credentials not configured" });
    }

    function getMondayOffset(dayOffset: number): string {
      const d = new Date();
      const day = d.getUTCDay();
      const diffToMonday = day === 0 ? -6 : 1 - day;
      d.setUTCDate(d.getUTCDate() + diffToMonday + dayOffset);
      return d.toISOString().split("T")[0];
    }

    const allRuns = [
      { label: "previous", dayOffset: -7 },
      { label: "current",  dayOffset:  0 },
      { label: "next",     dayOffset: +7 },
    ] as const;

    // Filter to requested weeks, defaulting to all three
    const requestedWeeks: Array<"previous" | "current" | "next"> =
      Array.isArray(req.body?.weeks) && req.body.weeks.length > 0
        ? req.body.weeks.filter((w: unknown) => ["previous", "current", "next"].includes(w as string))
        : ["previous", "current", "next"];

    const runs = allRuns.filter(r => requestedWeeks.includes(r.label));

    if (runs.length === 0) {
      return res.status(400).json({ ok: false, error: "No valid weeks specified" });
    }

    const branchIds = getConfiguredBranchIds();
    if (branchIds.length === 0) {
      return res.status(503).json({ ok: false, error: "No branches configured" });
    }

    const summary: Array<{ label: string; weekStartDate: string; queued: number; failed: number }> = [];

    // Respond immediately so the client isn't left waiting; fan-out runs in background.
    res.json({
      ok: true,
      message: `Weekly sync triggered for ${runs.map(r => r.label).join(", ")} — check server logs for progress`,
      branches: branchIds.length,
      weeks: runs.map(r => ({ label: r.label, weekStartDate: getMondayOffset(r.dayOffset) })),
    });

    for (const run of runs) {
      const weekStartDate = getMondayOffset(run.dayOffset);
      const results = await Promise.allSettled(
        branchIds.map(async (branchId) => {
          const result = await programmaticQueueSync(branchId, weekStartDate, `test-trigger-${run.label}`);
          logger.info(`Test trigger: branch queued (${run.label})`, { branchId, weekStartDate, ...result });
          return result;
        }),
      );
      const queued = results.filter(r => r.status === "fulfilled").length;
      const failed = results.filter(r => r.status === "rejected").length;
      results.forEach((r, i) => {
        if (r.status === "rejected") {
          logger.error(`Test trigger: branch queue failed (${run.label})`, undefined, {
            branchId: branchIds[i],
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      });
      summary.push({ label: run.label, weekStartDate, queued, failed });
      logger.info(`Test trigger: ${run.label} week complete`, { weekStartDate, queued, failed });
    }

    logger.info("Test trigger: sync complete", { runs: runs.map(r => r.label), summary });
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
  initiatedByUserId: string,
  slotArrayIndex = 0
): Promise<void> {
  // If a queued session already exists for this ID (promoted from queue), merge into it
  // rather than overwriting — preserving the original startedAt and userId.
  const existingSession = activeSessions.get(sessionId);
  const session: PipelineSession = existingSession
    ? { ...existingSession, status: "running", jobIds: [], phase: "starting", pendingParams: undefined }
    : { sessionId, status: "running", jobIds: [], phase: "starting", startedAt: new Date().toISOString(), branchId, initiatedByUserId };
  activeSessions.set(sessionId, session);

  try {
    // ── Reset any leftover context from a previous session on this slot ────────
    // When slot N is released after session A completes, its BrowserContext stays
    // open with live pages from session A.  If session B then runs on the same
    // slot, `runJob` would reuse that context and inherit orphaned pages.
    // `openPeoplePlanner` listens for a new-tab event on the context, so any
    // stale page navigating in the background can be captured instead of the real
    // PP tab — causing the "Could not find EVO launcher iframe" error.
    // Resetting here (saving cookies first) gives each pipeline session a clean
    // context while still allowing the login step to be skipped via the saved
    // session file.
    await resetSlotForNextSession(slotArrayIndex);

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

      const jobId = await runAutomationJob(config, slotArrayIndex);
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

    try {
      const { persistCarerHomeBranchesFromCgData } = await import("../../repositories/schedule.repository");
      await persistCarerHomeBranchesFromCgData(parsedData.cgData, branchId);
    } catch (mapErr) {
      logger.warn("Failed to persist carer home-branch mapping (non-fatal)", { mapErr });
    }

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
        await storage.enforceRetentionCpScheduledVisits(branchId);
      }
    } catch (err) {
      logger.warn("Failed to persist CP visits (non-fatal)", { err });
    }

    try {
      const { extractAllClientVisitsFromGHExcel } = await import("../../features/imports/excel-visit-extractor");
      const weekDates2 = result.dailySummary?.map(d => d.date) ?? [];
      if (weekDates2.length > 0) {
        const clientVisitMap = await extractAllClientVisitsFromGHExcel(guaranteedBuf, weekDates2, branchId, storage);
        const clientVisitRows: import("@shared/schema").InsertGhClientVisit[] = [];
        for (const [date, visits] of clientVisitMap) {
          for (const v of visits) {
            clientVisitRows.push({
              branchId,
              clientName: v.clientName,
              date,
              startTime: v.startTime,
              endTime: v.endTime,
              durationMinutes: v.durationMinutes,
              serviceType: v.serviceType ?? null,
              priority: v.priority ?? 1,
              lat: v.lat != null ? String(v.lat) : null,
              lng: v.lng != null ? String(v.lng) : null,
              postcode: v.postcode ?? null,
            });
          }
        }
        await storage.upsertGhClientVisitsByDates(branchId, weekDates2, clientVisitRows);
        await storage.enforceRetentionGhClientVisits(branchId);
        logger.info("Persisted GH client visits to database (date-aware upsert)", {
          branchId, totalVisits: clientVisitRows.length, weekDates: weekDates2.length,
        });
      }
    } catch (clientErr) {
      logger.warn("Failed to persist GH client visits (non-fatal)", { err: clientErr });
    }

    try {
      await hrRepo.syncHrCalendarFromResult(branchId, result);
      logger.info("HR calendar records upserted (automation)", { branchId });
    } catch (hrErr) {
      logger.warn("Failed to upsert HR calendar records (non-fatal)", { err: hrErr });
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
      storage.enforceRetentionLatestWeeks(branchId).catch((e) =>
        logger.warn('Retention sweep failed (non-fatal)', { err: e }),
      );
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

// ─── Multi-week pipeline session ─────────────────────────────────────────────
/**
 * Run all weeks for one branch in a SINGLE Playwright session.
 * Login once → iterate weeks downloading + processing each → logout.
 * The slot is held across all weeks; no context reset happens between weeks.
 */
async function runMultiWeekPipelineSession(
  sessionId: string,
  branchId: string,
  branchDisplayName: string,
  ppConfig: BranchPPConfig,
  weekStartDates: string[],
  initiatedByUserId: string,
  slotArrayIndex = 0
): Promise<void> {
  const existingSession = activeSessions.get(sessionId);
  const session: PipelineSession = existingSession
    ? { ...existingSession, status: "running", jobIds: [], phase: "starting", pendingParams: undefined }
    : {
        sessionId, status: "running", jobIds: [], phase: "starting",
        startedAt: new Date().toISOString(), branchId, initiatedByUserId,
      };

  // Initialise weeklyProgress if not already set (e.g. when promoted from queue).
  if (!session.weeklyProgress || session.weeklyProgress.length === 0) {
    session.weeklyProgress = weekStartDates.map(ws => {
      const end = new Date(ws);
      end.setUTCDate(end.getUTCDate() + 6);
      return { weekStartDate: ws, weekEndDate: end.toISOString().split("T")[0], status: "pending" as const };
    });
  }

  activeSessions.set(sessionId, session);

  const reportTypes = ["visitsExport", "careGiverExport", "careGiverAvailabilityExport"] as const;

  try {
    // Reset any leftover context from a previous session on this slot (once, at start).
    await resetSlotForNextSession(slotArrayIndex);

    logger.info("Multi-week pipeline session starting", { sessionId, branchId, weekCount: weekStartDates.length });

    for (let wi = 0; wi < weekStartDates.length; wi++) {
      const weekStartDate = weekStartDates[wi];
      const weekEnd = new Date(weekStartDate);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      const weekEndDate = weekEnd.toISOString().split("T")[0];

      // Update this week's progress to "downloading".
      if (session.weeklyProgress) {
        session.weeklyProgress[wi] = { ...session.weeklyProgress[wi], status: "downloading" };
        activeSessions.set(sessionId, session);
      }

      const downloadedBuffers: Record<string, Buffer> = {};

      try {
        // Download all 3 reports for this week.
        for (const reportType of reportTypes) {
          const templateMap = REPORT_TEMPLATE_MAP[reportType];
          const exportTemplate = REPORT_EXPORT_TEMPLATES[reportType];

          session.phase = `downloading_${reportType} (week ${wi + 1}/${weekStartDates.length})`;
          activeSessions.set(sessionId, session);

          const config: JobConfig = {
            branchUrl: ppConfig.branchUrl,
            plannerArea: ppConfig.plannerArea,
            startDate: weekStartDate,
            endDate: weekEndDate,
            reportType,
            exportType: "Excel",
            exportTemplate,
            selectAllCareGivers: reportType === "careGiverAvailabilityExport",
            branchId,
          };

          const jobId = await runAutomationJob(config, slotArrayIndex);
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
          logger.info("File buffered", {
            reportType, weekStartDate, fieldName: templateMap.fieldName,
            bytes: downloadedBuffers[templateMap.fieldName].length,
          });
        }

        // Process this week's data.
        if (session.weeklyProgress) {
          session.weeklyProgress[wi] = { ...session.weeklyProgress[wi], status: "processing" };
          activeSessions.set(sessionId, session);
        }
        session.phase = `processing (week ${wi + 1}/${weekStartDates.length})`;
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
          logger.warn("Failed to persist GH buffer to DB (non-fatal)", { weekStartDate, err });
        }

        try {
          const { persistCarerHomeBranchesFromCgData } = await import("../../repositories/schedule.repository");
          await persistCarerHomeBranchesFromCgData(parsedData.cgData, branchId);
        } catch (mapErr) {
          logger.warn("Failed to persist carer home-branch mapping (non-fatal)", { weekStartDate, mapErr });
        }

        // NOTE: Do NOT call clearAllVisits between weeks — that would wipe data
        // from already-processed weeks. The date-aware upsert handles isolation.

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
                    branchId, cpName,
                    clientName: entry.clientName,
                    clientLat:  entry.lat  != null ? String(entry.lat)  : null,
                    clientLng:  entry.lng  != null ? String(entry.lng)  : null,
                    clientPostcode: entry.postcode ?? null,
                    date, startTime: entry.startTime, endTime: entry.endTime,
                  });
                }
              }
            }
            await storage.upsertCpScheduledVisitsByDates(branchId, weekDates, visitRows);
          }
        } catch (err) {
          logger.warn("Failed to persist CP visits (non-fatal)", { weekStartDate, err });
        }

        try {
          const { extractAllClientVisitsFromGHExcel } = await import("../../features/imports/excel-visit-extractor");
          const weekDates2 = result.dailySummary?.map(d => d.date) ?? [];
          if (weekDates2.length > 0) {
            const clientVisitMap = await extractAllClientVisitsFromGHExcel(guaranteedBuf, weekDates2, branchId, storage);
            const clientVisitRows: import("@shared/schema").InsertGhClientVisit[] = [];
            for (const [date, visits] of clientVisitMap) {
              for (const v of visits) {
                clientVisitRows.push({
                  branchId, clientName: v.clientName, date,
                  startTime: v.startTime, endTime: v.endTime,
                  durationMinutes: v.durationMinutes,
                  serviceType: v.serviceType ?? null,
                  priority: v.priority ?? 1,
                  lat: v.lat != null ? String(v.lat) : null,
                  lng: v.lng != null ? String(v.lng) : null,
                  postcode: v.postcode ?? null,
                });
              }
            }
            await storage.upsertGhClientVisitsByDates(branchId, weekDates2, clientVisitRows);
          }
        } catch (clientErr) {
          logger.warn("Failed to persist GH client visits (non-fatal)", { weekStartDate, err: clientErr });
        }

        try {
          await hrRepo.syncHrCalendarFromResult(branchId, result);
          logger.info("HR calendar records upserted (multi-week automation)", { branchId, weekStartDate });
        } catch (hrErr) {
          logger.warn("Failed to upsert HR calendar records (non-fatal)", { weekStartDate, err: hrErr });
        }

        if (result.dailySummary && result.dailySummary.length > 0) {
          const { weekStart, weekEnd: wkEnd } = getCanonicalWeekBoundaries(result.dailySummary[0].date);
          await storage.saveCapacityAnalysis({
            branchId,
            weekStartDate: weekStart,
            weekEndDate:   wkEnd,
            kpis:          result.kpis,
            dailySummary:  result.dailySummary,
            employeesByDate: result.employeesByDate,
            employeeSummaryByDate: result.employeeSummaryByDate || {},
            warnings: result.warnings || [],
          });
          // Retention is enforced once for all weeks at the end of a multi-week run (below).
        }

        // Mark this week as completed.
        if (session.weeklyProgress) {
          session.weeklyProgress[wi] = { ...session.weeklyProgress[wi], status: "completed" };
          activeSessions.set(sessionId, session);
        }

        logger.info("Multi-week: week processed", { sessionId, branchId, weekStartDate, weekIndex: wi + 1, weekCount: weekStartDates.length });

      } catch (weekErr) {
        const weekMsg = weekErr instanceof Error ? weekErr.message : String(weekErr);
        logger.error("Multi-week: week failed", weekErr instanceof Error ? weekErr : undefined, { sessionId, branchId, weekStartDate });
        if (session.weeklyProgress) {
          session.weeklyProgress[wi] = { ...session.weeklyProgress[wi], status: "failed", error: weekMsg };
          activeSessions.set(sessionId, session);
        }
        // Continue processing remaining weeks rather than aborting the whole session.
      }
    }

    // Run retention once after all weeks are done.
    try {
      await storage.enforceRetentionCpScheduledVisits(branchId);
      await storage.enforceRetentionGhClientVisits(branchId);
      await storage.enforceRetentionLatestWeeks(branchId);
    } catch (retErr) {
      logger.warn("Failed to enforce retention after multi-week sync (non-fatal)", { err: retErr });
    }

    const failedCount = session.weeklyProgress?.filter(w => w.status === "failed").length ?? 0;
    const completedCount = session.weeklyProgress?.filter(w => w.status === "completed").length ?? 0;

    if (completedCount === 0 && failedCount > 0) {
      session.status      = "failed";
      session.error       = `All ${weekStartDates.length} weeks failed`;
      session.phase       = "error";
    } else {
      session.status      = "completed";
      session.phase       = "complete";
    }
    session.completedAt = new Date().toISOString();
    session.result      = { completedWeeks: completedCount, failedWeeks: failedCount };
    activeSessions.set(sessionId, session);

    logger.info("Multi-week pipeline session completed", {
      sessionId, branchId, completedCount, failedCount, totalWeeks: weekStartDates.length,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    session.status      = "failed";
    session.error       = message;
    session.phase       = "error";
    session.completedAt = new Date().toISOString();
    activeSessions.set(sessionId, session);
    logger.error("Multi-week pipeline session failed", err instanceof Error ? err : undefined, { sessionId });
    throw err;
  }
}
