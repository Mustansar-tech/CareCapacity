import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { logger } from "../../infrastructure/logger";
import type { ReportType } from "./report-configs";
import { getReportConfig } from "./report-configs";

export interface JobConfig {
  /** Direct Access Workspace URL for this branch, e.g. https://go.accessacloud.com/o/home-instead-uk-ayr-kilmarnock/ */
  branchUrl: string;
  /** Exact Franchise name to select in PP export forms (Area is always left as "All") */
  plannerArea?: string;
  startDate: string;
  endDate: string;
  reportType: ReportType;
  exportType: string;
  exportTemplate: string;
  selectAllCareGivers?: boolean;
  includeBankDetails?: boolean;
  careGiverType?: string;
  careGiverStatus?: string;
  branchId?: string;
}

export interface AutomationJob {
  id: string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  downloadReady: boolean;
  fileName: string | null;
  filePath: string | null;
  config: JobConfig;
  logs: string[];
}

// ─── Paths ────────────────────────────────────────────────────────────────────
const DOWNLOAD_DIR = path.resolve("/tmp/pp-automation-downloads");
const DEBUG_DIR = path.resolve(process.cwd(), "pp-debug-screenshots");
const LOGIN_URL = "https://identity.accessacloud.com/auth/signin?force=true&setemail=false&settenant=false";
const WORKSPACE_URL = "https://go.accessacloud.com/";

// ─── Shared browser ───────────────────────────────────────────────────────────
// A single Chromium process is shared across all account slots. Each slot gets
// its own BrowserContext (fully isolated: separate cookies, localStorage, sessions).
// Using one process instead of N processes avoids OS-level resource contention
// (memory, sandbox limits) that causes "navigation interrupted" collisions when
// multiple slots try to launch their own browser simultaneously.

let sharedBrowser: Browser | null = null;
let browserLaunchPromise: Promise<Browser> | null = null;

async function getOrLaunchSharedBrowser(): Promise<Browser> {
  if (sharedBrowser?.isConnected()) return sharedBrowser;

  // Coalesce concurrent launch attempts into one Promise so we never start two
  // Chromium processes at the same time.
  if (browserLaunchPromise) return browserLaunchPromise;

  browserLaunchPromise = (async () => {
    const executablePath = getChromiumExecutablePath();
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      ...(executablePath ? { executablePath } : {}),
    });
    browser.on("disconnected", () => {
      sharedBrowser = null;
      browserLaunchPromise = null;
      // Invalidate all slot contexts so the next job on each slot gets a fresh one.
      for (const s of slotStates) {
        s.context = null;
        s.plannerPage = null;
        s.plannerBranchUrl = null;
      }
      logger.warn("Shared Chromium browser disconnected — all slot contexts reset");
    });
    sharedBrowser = browser;
    browserLaunchPromise = null;
    logger.info("Shared Chromium browser launched");
    return browser;
  })();

  return browserLaunchPromise;
}

// ─── Account pool ─────────────────────────────────────────────────────────────
interface SlotState {
  /** 1-based display index */
  index: number;
  email: string;
  password: string;
  sessionFile: string;
  /** Each slot owns one BrowserContext inside the shared browser. */
  context: BrowserContext | null;
  plannerPage: Page | null;
  plannerBranchUrl: string | null;
  currentJobId: string | null;
}

function makeSlot(displayIndex: number, email: string, password: string): SlotState {
  return {
    index: displayIndex,
    email,
    password,
    sessionFile: path.resolve(`/tmp/pp-session-slot-${displayIndex}.json`),
    context: null,
    plannerPage: null,
    plannerBranchUrl: null,
    currentJobId: null,
  };
}

/**
 * Maximum account slots supported by the pool.
 *
 * Env-var layout:
 *   Slot 1 : ACCESS_EMAIL   / ACCESS_PASSWORD          (required)
 *   Slot 2 : ACCESS_EMAIL_1 / ACCESS_PASSWORD_1        (optional)
 *   Slot 3 : ACCESS_EMAIL_2 / ACCESS_PASSWORD_2        (optional)
 *   Slot 4 : ACCESS_EMAIL_3 / ACCESS_PASSWORD_3        (optional)
 *   Slot 5 : ACCESS_EMAIL_4 / ACCESS_PASSWORD_4        (optional)
 *   Slot 6 : ACCESS_EMAIL_5 / ACCESS_PASSWORD_5        (optional)
 *
 * With all six pairs configured the pool reaches its full capacity of 6
 * concurrent sessions.
 */
export const MAX_ACCOUNT_SLOTS = 6;

/**
 * Load all configured accounts from the env-var layout above.
 *
 * Runtime slot numbers are contiguous (1..N) regardless of which optional
 * pairs are present, so session files are always
 * /tmp/pp-session-slot-1.json … /tmp/pp-session-slot-N.json with no gaps.
 * Only slots where BOTH email and password are set are added to the pool.
 */
function loadAccountPool(): SlotState[] {
  const pool: SlotState[] = [];
  const e0 = process.env.ACCESS_EMAIL;
  const p0 = process.env.ACCESS_PASSWORD;
  if (e0 && p0) pool.push(makeSlot(1, e0, p0));
  for (const n of [1, 2, 3, 4, 5]) {
    const e = process.env[`ACCESS_EMAIL_${n}`];
    const p = process.env[`ACCESS_PASSWORD_${n}`];
    if (e && p) pool.push(makeSlot(pool.length + 1, e, p));
  }
  return pool;
}

// ─── State ────────────────────────────────────────────────────────────────────
const jobs = new Map<string, AutomationJob>();
const slotStates: SlotState[] = loadAccountPool();

ensureDir(DOWNLOAD_DIR);

logger.info("People Planner account pool loaded", { slotCount: slotStates.length, slots: slotStates.map(s => s.index) });

// ─── Utilities ────────────────────────────────────────────────────────────────
function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function generateId(): string {
  return `ppjob_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function addLog(job: AutomationJob, message: string) {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  job.logs.push(`[${ts}] ${message}`);
  logger.info(message, { jobId: job.id });
}

function getChromiumExecutablePath(): string | undefined {
  try {
    const p = execSync("which chromium-browser 2>/dev/null || which chromium 2>/dev/null || echo ''", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (p) return p;
  } catch {
    // fall through — use Playwright's built-in
  }
  return undefined;
}

// ─── Debug screenshots ────────────────────────────────────────────────────────
async function debugScreenshot(page: Page, name: string): Promise<void> {
  try {
    ensureDir(DEBUG_DIR);
    await page.screenshot({ path: path.join(DEBUG_DIR, `${name}.png`), fullPage: false });
  } catch {
    // non-fatal
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Tear down the slot's browser context before a NEW pipeline session starts.
 *
 * Why this is necessary
 * ─────────────────────
 * When session A finishes on slot N, its BrowserContext stays open (pages still
 * alive, cookies still hot).  If session B is then dispatched to the same slot,
 * `runJob` finds `slot.context !== null` and reuses it — inheriting orphaned
 * pages from session A.  When `openPeoplePlanner` subsequently listens for a
 * new-tab event on that context, it may capture a stale tab that is mid-redirect
 * to the login page rather than the freshly-opened PP tab, producing the
 * "Could not find EVO launcher iframe" error.
 *
 * The fix: save the session file first (so the next context can skip re-login),
 * then close the entire context.  `runJob` will create a clean context on the
 * next call, using the saved session file to restore cookies.
 */
export async function resetSlotForNextSession(slotArrayIndex: number): Promise<void> {
  const slot = slotStates[slotArrayIndex];
  if (!slot) return;
  if (!slot.context) return; // nothing to reset

  // Persist cookies/session so the next context can skip the login form.
  await slot.context.storageState({ path: slot.sessionFile }).catch(() => {});

  // Close every page in the context (workspacePage, plannerPage, any orphans).
  await slot.context.close().catch(() => {});

  slot.context = null;
  slot.plannerPage = null;
  slot.plannerBranchUrl = null;

  logger.info("Slot context reset for next session", { slotArrayIndex, displayIndex: slot.index });
}

export function getJob(id: string): AutomationJob | undefined {
  return jobs.get(id);
}

export function listJobs(): AutomationJob[] {
  return Array.from(jobs.values())
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 20);
}

export function getCurrentJob(): AutomationJob | null {
  const slot0 = slotStates[0];
  if (!slot0?.currentJobId) return null;
  return jobs.get(slot0.currentJobId) ?? null;
}

export function isRunning(): boolean {
  return slotStates.some(s => s.currentJobId !== null);
}

export function getQueueLength(): number {
  return 0; // Queue is managed at the session layer in automation-routes.ts
}

/** Returns the total number of configured account slots. */
export function getSlotCount(): number {
  return slotStates.length;
}

/** Returns the 0-based array index of the first idle slot, or -1 if all are busy. */
export function getIdleSlotIndex(): number {
  return slotStates.findIndex(s => s.currentJobId === null);
}

export interface SlotStatus {
  slotIndex: number;
  displayIndex: number;
  busy: boolean;
  currentJobId: string | null;
}

/** Returns the status of every slot in the pool. */
export function getSlotStatus(): SlotStatus[] {
  return slotStates.map((s, i) => ({
    slotIndex: i,
    displayIndex: s.index,
    busy: s.currentJobId !== null,
    currentJobId: s.currentJobId,
  }));
}

export function getDownloadPath(jobId: string): string | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (job.filePath && fs.existsSync(job.filePath)) return job.filePath;
  if (job.fileName) {
    const fp = path.join(DOWNLOAD_DIR, `${jobId}-${job.fileName}`);
    if (fs.existsSync(fp)) return fp;
  }
  return null;
}

/**
 * Run an automation job on the given slot. The slot index is 0-based (array index).
 * The caller (automation-routes.ts) is responsible for assigning sessions to slots
 * and ensuring only one job runs per slot at a time.
 */
export async function runAutomationJob(config: JobConfig, slotArrayIndex = 0): Promise<string> {
  ensureDir(DOWNLOAD_DIR);

  const slot = slotStates[slotArrayIndex];
  if (!slot) {
    throw new Error(`Slot ${slotArrayIndex} does not exist (pool has ${slotStates.length} slot(s))`);
  }

  const id = generateId();
  const job: AutomationJob = {
    id,
    status: "pending",
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    downloadReady: false,
    fileName: null,
    filePath: null,
    config,
    logs: [],
  };

  jobs.set(id, job);
  slot.currentJobId = id;

  runJob(job, slot).catch((err) => {
    logger.error("Unhandled automation error", err, { jobId: id, slotIndex: slotArrayIndex });
  }).finally(() => {
    slot.currentJobId = null;
  });

  return id;
}

// ─── Wait for a job to finish polling ─────────────────────────────────────────
export async function waitForJob(jobId: string, timeoutMs = 300000): Promise<AutomationJob> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = jobs.get(jobId);
    if (!job) throw new Error(`Job ${jobId} not found`);
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Job ${jobId} timed out after ${timeoutMs}ms`);
}

// ─── Core job runner (slot-aware) ────────────────────────────────────────────
async function runJob(job: AutomationJob, slot: SlotState): Promise<void> {
  job.status = "running";
  addLog(job, `Starting automation on account slot ${slot.index}...`);

  const { email, password } = slot;
  if (!email || !password) {
    job.status = "failed";
    job.error = `No credentials configured for slot ${slot.index}`;
    job.completedAt = new Date().toISOString();
    addLog(job, `Failed: ${job.error}`);
    return;
  }

  try {
    // ── Shared browser + per-slot context ──────────────────────────────────
    // All slots share one Chromium process; each gets its own isolated context
    // (separate cookies, sessions, storage). This avoids OS-level resource
    // contention that caused "navigation interrupted" errors when multiple
    // browser processes tried to run in parallel.
    if (!slot.context) {
      addLog(job, "Acquiring shared browser...");
      const browser = await getOrLaunchSharedBrowser();
      slot.context = await browser.newContext({
        storageState: fs.existsSync(slot.sessionFile) ? slot.sessionFile : undefined,
        acceptDownloads: true,
      });
      slot.plannerPage = null;
      addLog(job, `Browser context ready for slot ${slot.index}.`);
    }

    // ── Step 1: Login ─────────────────────────────────────────────────────
    // ── Step 2: Navigate to branch URL to select the branch ───────────────
    // ── Step 3: Open People Planner from the Access launcher ─────────────
    const branchUrl = job.config.branchUrl;
    const branchUrlChanged = slot.plannerBranchUrl !== null && slot.plannerBranchUrl !== branchUrl;

    if (branchUrlChanged) {
      addLog(job, `Branch URL changed (${slot.plannerBranchUrl} → ${branchUrl}). Re-opening People Planner for new branch.`);
      logger.info("Branch URL changed — resetting PP session", {
        previous: slot.plannerBranchUrl,
        next: branchUrl,
        slotIndex: slot.index,
      });
      if (slot.plannerPage && !slot.plannerPage.isClosed()) {
        await slot.plannerPage.close().catch(() => {});
      }
      slot.plannerPage = null;
      slot.plannerBranchUrl = null;
    }

    let plannerPage: Page;
    if (!slot.plannerPage || slot.plannerPage.isClosed()) {
      const workspacePage = await slot.context.newPage();

      addLog(job, "Navigating to Access Workspace login...");
      await workspacePage.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await workspacePage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

      const needsLogin = await checkNeedsLogin(workspacePage);
      if (needsLogin) {
        addLog(job, "Logging in with credentials...");
        await login(workspacePage, email, password);
        await slot.context.storageState({ path: slot.sessionFile });
        addLog(job, "Login successful, session saved.");
      } else {
        addLog(job, "Active session detected — skipping login form.");
      }

      addLog(job, `Selecting branch via URL: ${branchUrl}`);
      await workspacePage.goto(branchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await workspacePage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

      // Access Cloud may trigger a tenant-specific OAuth challenge after navigating
      // to the branch workspace URL (even when the general login already succeeded).
      // Detect and complete that before trying to open People Planner.
      const reAuthed = await handleTenantReAuth(workspacePage, email, password);
      if (reAuthed) {
        addLog(job, "Tenant re-auth completed — re-saving session and re-navigating to branch...");
        await slot.context.storageState({ path: slot.sessionFile });
        await workspacePage.goto(branchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await workspacePage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        // One more safety check — if still on identity, throw clearly
        const urlAfter = workspacePage.url();
        if (urlAfter.includes("identity.accessacloud.com/auth/")) {
          throw new Error(`Still on login page after re-auth for branch ${branchUrl}: ${urlAfter}`);
        }
      }

      addLog(job, "Opening People Planner from the Access launcher...");
      slot.plannerPage = await openPeoplePlanner(slot.context, workspacePage);
      slot.plannerBranchUrl = branchUrl;
      addLog(job, "People Planner opened.");

      // Close the workspace page — PP is now open in its own tab and we no longer
      // need the launcher page.  Leaving it open risks future context.waitForEvent("page")
      // calls capturing stale redirects from this orphaned page.
      await workspacePage.close().catch(() => {});
    } else {
      addLog(job, `Reusing existing People Planner session for ${branchUrl}.`);
    }

    plannerPage = slot.plannerPage;

    const reportConfig = getReportConfig(job.config.reportType);
    addLog(job, `Navigating to ${reportConfig.key} export...`);
    await navigateToExport(plannerPage, job.config);
    addLog(job, `On ${reportConfig.key} page.`);

    addLog(job, "Configuring export settings...");
    await configureExportForm(plannerPage, job.config);
    addLog(job, "Export configured.");

    addLog(job, "Triggering download...");
    const savedFile = await triggerDownload(plannerPage, job.id);
    const rawName = path.basename(savedFile);
    const cleanName = rawName.replace(/^ppjob_\d+_[a-z0-9]+-/, "");

    await slot.context.storageState({ path: slot.sessionFile });

    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.downloadReady = true;
    job.fileName = cleanName;
    job.filePath = savedFile;
    addLog(job, `Download complete: ${cleanName}`);
    logger.info("Job completed", { jobId: job.id, cleanName, savedFile, slotIndex: slot.index });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.error = message;
    job.completedAt = new Date().toISOString();
    addLog(job, `Error: ${message}`);
    logger.error("Automation job failed", err instanceof Error ? err : undefined, { jobId: job.id, slotIndex: slot.index });

    if (slot.plannerPage && !slot.plannerPage.isClosed()) {
      await debugScreenshot(slot.plannerPage, `fail-${job.id}`).catch(() => {});
    }

    // Close this slot's context so the next job starts with a clean state.
    // We do NOT close the shared browser — other slots continue unaffected.
    slot.plannerPage = null;
    slot.plannerBranchUrl = null;
    if (slot.context) {
      await slot.context.close().catch(() => {});
      slot.context = null;
    }
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
async function checkNeedsLogin(page: Page): Promise<boolean> {
  try {
    const url = page.url();
    if (url.includes("identity.accessacloud.com") || url.includes("auth/signin")) return true;
    return await page.getByPlaceholder(/enter your email address/i)
      .isVisible({ timeout: 3000 }).catch(() => false);
  } catch {
    return false;
  }
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  const emailField = page.getByPlaceholder(/enter your email address/i);
  await emailField.waitFor({ state: "visible", timeout: 15000 });
  await emailField.fill(email);
  await page.getByRole("button", { name: /next/i }).click();

  const pwField = page.getByPlaceholder(/enter your password/i);
  await pwField.waitFor({ state: "visible", timeout: 15000 });
  await pwField.fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  try {
    await page.waitForURL(
      (url) => !url.href.includes("identity.accessacloud.com/auth/signin"),
      { timeout: 60000, waitUntil: "commit" }
    );
  } catch {
    await debugScreenshot(page, "login-timeout");
    const currentUrl = page.url();
    const title = await page.title().catch(() => "(unknown)");
    throw new Error(`Login redirect timed out. Still on: ${currentUrl} — "${title}".`);
  }

  // Handle "Stay signed in?" prompt
  await page.waitForTimeout(1500);
  const staySignedIn = page.getByRole("button", { name: /yes|stay signed in|keep me signed in/i });
  if (await staySignedIn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await staySignedIn.click();
    await page.waitForTimeout(1000);
  }

  // Always land on workspace after login
  if (!page.url().includes("go.accessacloud.com")) {
    await page.goto(WORKSPACE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
}

// ─── Tenant re-auth handler ───────────────────────────────────────────────────
/**
 * After a general login, navigating to a specific Access Cloud workspace
 * (e.g. /o/home-instead-uk-perthshire/) can trigger a TENANT-specific OAuth
 * challenge.  Access Cloud redirects to identity.accessacloud.com/auth/password
 * with acr_values=tenant:<slug>.  This is NOT caught by checkNeedsLogin (which
 * only checks the initial auth/signin URL), so openPeoplePlanner would spin for
 * 30 s and then fail.
 *
 * This function detects the password-step challenge and completes it so the
 * workspace page lands on the correct tenant.
 *
 * Returns true if re-auth was performed (caller should re-save session + re-navigate).
 */
async function handleTenantReAuth(page: Page, email: string, password: string): Promise<boolean> {
  const url = page.url();
  const onIdentity = url.includes("identity.accessacloud.com/auth/");
  if (!onIdentity) return false;

  logger.warn("Tenant-specific re-auth challenge detected", { url });

  // If we landed on auth/password (email already known — just need password)
  if (url.includes("auth/password")) {
    try {
      const pwField = page.getByPlaceholder(/enter your password/i);
      if (await pwField.isVisible({ timeout: 8000 }).catch(() => false)) {
        await pwField.fill(password);
        await page.getByRole("button", { name: /sign in/i }).click();
        await page.waitForURL(
          (u) => !u.href.includes("identity.accessacloud.com/auth/"),
          { timeout: 60000, waitUntil: "commit" },
        );
        await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
        return true;
      }
    } catch {
      // Fall through to full re-login below
    }
  }

  // Full re-login (covers auth/signin or any other identity page)
  await login(page, email, password);
  return true;
}

// ─── Workspace branch selection ───────────────────────────────────────────────
function branchNameToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function selectWorkspaceBranch(page: Page, branchName: string): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const branchSlug = branchNameToSlug(branchName);
  const currentUrl = page.url();
  if (typeof currentUrl === "string" && currentUrl.includes(branchSlug)) return;

  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const orgSwitcher = page.locator("access-shell-org-switcher").first();
  if (await orgSwitcher.isVisible({ timeout: 5000 }).catch(() => false)) {
    await orgSwitcher.click({ force: true });
  } else {
    const fallback = page.locator("button, a").filter({ hasText: /Home Instead/i }).first();
    if (await fallback.isVisible({ timeout: 5000 }).catch(() => false)) {
      await fallback.click({ force: true });
    }
  }
  await page.waitForTimeout(1500);

  const branchOption = page.getByText(branchName, { exact: true }).first();
  if (await branchOption.isVisible({ timeout: 8000 }).catch(() => false)) {
    await branchOption.click({ force: true });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
}

// ─── Open People Planner tab ──────────────────────────────────────────────────
async function openPeoplePlanner(context: BrowserContext, page: Page): Promise<Page> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  const accessBtn = page.locator("access-button").first();
  if (await accessBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await accessBtn.click({ force: true });
  } else {
    await page.evaluate(() => {
      const btn = document.querySelector("access-button") as HTMLElement | null;
      if (btn) btn.click();
    });
  }

  // Wait up to 30 seconds for the EVO launcher iframe to appear, polling every 2s.
  // Fail fast if the page redirects to an identity/login page — that means Access
  // Cloud triggered a tenant re-auth that should have been handled before this call.
  let launcherFrame: import("playwright").Frame | null = null;
  const launcherDeadline = Date.now() + 30000;
  while (!launcherFrame && Date.now() < launcherDeadline) {
    await page.waitForTimeout(2000);

    // Fast-fail: if the page is now on identity.accessacloud.com, the workspace
    // session was lost — throw immediately so the caller can retry with re-auth.
    const currentUrl = page.url();
    if (currentUrl.includes("identity.accessacloud.com/auth/")) {
      const allFrameUrls = page.frames().map(f => f.url()).join(", ");
      throw new Error(
        `Could not find EVO launcher iframe after 30s. Available frames: ${allFrameUrls}`
      );
    }

    const currentFrames = page.frames();
    launcherFrame = currentFrames.find(f =>
      f.url().includes("button-app.production.workspace.accessacloud.com")
    ) ?? null;
    if (!launcherFrame) {
      for (const frame of currentFrames) {
        const hasLauncher = await frame.evaluate(() =>
          !!(document.body?.innerText?.includes("People Planner"))
        ).catch(() => false);
        if (hasLauncher) { launcherFrame = frame; break; }
      }
    }
  }

  let plannerPage: Page;

  if (launcherFrame) {
    const productsTab = launcherFrame.getByText(/^Products$/i).first();
    if (await productsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
      await productsTab.click();
      await page.waitForTimeout(1200);
    }

    const ppCandidates = [
      launcherFrame.getByText("People Planner", { exact: true }).first(),
      launcherFrame.getByRole("link", { name: /people planner/i }).first(),
      launcherFrame.locator("a").filter({ hasText: /people planner/i }).first(),
      launcherFrame.locator("[href*='peopleplanner']").first(),
    ];

    let ppTile = null;
    for (const c of ppCandidates) {
      if (await c.isVisible({ timeout: 2000 }).catch(() => false)) { ppTile = c; break; }
    }

    if (!ppTile) {
      await debugScreenshot(page, "no-pp-tile");
      throw new Error("People Planner tile not found in launcher frame.");
    }

    const ppHref = await ppTile.evaluate((el) => {
      const a = el instanceof HTMLAnchorElement ? el : el.closest("a");
      return a?.href ?? "";
    }).catch(() => "");

    const pagesBefore = context.pages();
    const newTabPromise = context.waitForEvent("page", { timeout: 60000 });
    newTabPromise.catch(() => {});
    await ppTile.click({ force: true });

    try {
      plannerPage = await newTabPromise;
    } catch {
      const pagesAfter = context.pages();
      const newPages = pagesAfter.filter(p => !pagesBefore.includes(p));
      if (newPages.length > 0) {
        plannerPage = newPages[newPages.length - 1];
      } else if (ppHref) {
        const newTabPromise2 = context.waitForEvent("page", { timeout: 30000 });
        newTabPromise2.catch(() => {});
        await page.evaluate((url) => window.open(url, "_blank"), ppHref);
        plannerPage = await newTabPromise2;
      } else {
        await debugScreenshot(page, "no-new-tab");
        throw new Error("Clicked People Planner but no new tab opened.");
      }
    }
  } else {
    await debugScreenshot(page, "no-launcher-frame");
    const allFrameUrls = page.frames().map(f => f.url()).join(", ");
    throw new Error(
      `Could not find EVO launcher iframe after 30s. Available frames: ${allFrameUrls}`
    );
  }

  await plannerPage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await plannerPage.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  await plannerPage.bringToFront();

  return plannerPage;
}

// ─── Navigate to export page ──────────────────────────────────────────────────
async function navigateToExport(plannerPage: Page, config: JobConfig): Promise<void> {
  const reportConfig = getReportConfig(config.reportType);

  if (reportConfig.directUrl) {
    // Resolve the directUrl relative to the People Planner tab's own URL.
    // The branchUrl is only used to select the branch in Access Workspace;
    // the PP tab runs on its own domain (e.g. peopleplanner.accessacloud.com).
    const targetUrl = new URL(reportConfig.directUrl, plannerPage.url()).toString();
    logger.info(`Navigating directly to ${config.reportType}`, { targetUrl });
    await plannerPage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await plannerPage.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await plannerPage.waitForTimeout(2000);
  } else {
    for (const step of reportConfig.menuPath) {
      const loc = plannerPage.locator(`text=${step}`);
      if (await loc.count().catch(() => 0) === 0) continue;
      const isFinal = step === reportConfig.menuPath[reportConfig.menuPath.length - 1];
      if (isFinal) {
        await loc.first().click({ force: true });
      } else {
        await loc.first().hover({ force: true });
        await plannerPage.waitForTimeout(300);
      }
    }
    await plannerPage.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await plannerPage.waitForTimeout(2000);
  }
}

// ─── Form frame detection ─────────────────────────────────────────────────────
async function getReportFormFrame(plannerPage: Page): Promise<import("playwright").Frame> {
  const mainSelects = await plannerPage.mainFrame().locator("select").count().catch(() => 0);
  const mainExportBtn = await plannerPage.mainFrame().locator("input[type='image'][name='btnExport']").count().catch(() => 0);
  if (mainSelects > 0 || mainExportBtn > 0) return plannerPage.mainFrame();

  for (const frame of plannerPage.frames()) {
    const selCount = await frame.locator("select").count().catch(() => 0);
    const btnCount = await frame.locator("input[type='image'][name='btnExport']").count().catch(() => 0);
    if (selCount > 0 || btnCount > 0) return frame;
  }

  return plannerPage.mainFrame();
}

// ─── Configure export form ────────────────────────────────────────────────────
async function configureExportForm(plannerPage: Page, config: JobConfig): Promise<void> {
  const reportConfig = getReportConfig(config.reportType);
  const formFrame = await getReportFormFrame(plannerPage);

  const normalize = (text: string): string =>
    text.toLowerCase().replace(/- uk -/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

  const selectBest = async (sel: ReturnType<Page["locator"]>, value: string, name: string) => {
    const options = await sel.evaluate((s: HTMLSelectElement) =>
      Array.from(s.options).map((o, i) => ({ text: o.text.trim(), val: o.value, index: i }))
    ).catch(() => [] as { text: string; val: string; index: number }[]);

    const textCounts = new Map<string, number>();
    const uniqueOpts = options.map((opt) => {
      const count = (textCounts.get(opt.text) || 0) + 1;
      textCounts.set(opt.text, count);
      return { ...opt, occurrenceNumber: count };
    });

    const duplicateMatch = value.match(/^(.+)\s+\((\d+)\)$/);
    const target = normalize(duplicateMatch ? duplicateMatch[1] : value);
    const targetOccurrence = duplicateMatch ? parseInt(duplicateMatch[2]) : null;

    // Exclude "live in care" variants — we always want the main area option
    const filtered = uniqueOpts.filter(o => !o.text.toLowerCase().includes("live in care"));

    // Priority 1: exact normalize match (prevents "Glasgow North" matching "North Lanarkshire & Glasgow East")
    const exactMatches = filtered.filter(o => normalize(o.text) === target);

    // Priority 2: option text starts with target (e.g. "Glasgow North" starts with "glasgow north")
    const startsWithMatches = filtered.filter(o =>
      normalize(o.text).startsWith(target) || target.startsWith(normalize(o.text))
    );

    // Priority 3: substring match (broadest)
    const substrMatches = filtered.filter(o =>
      normalize(o.text).includes(target) || target.includes(normalize(o.text))
    );

    // Pick best candidate set in priority order
    const candidates = exactMatches.length > 0 ? exactMatches
                     : startsWithMatches.length > 0 ? startsWithMatches
                     : substrMatches;

    let match = null;
    if (targetOccurrence && candidates.length > 0) {
      match = candidates.find(o => o.occurrenceNumber === targetOccurrence);
    }
    if (!match && candidates.length > 0) match = candidates[0];

    if (!match) {
      // Log exactly why we are falling back so we can diagnose mismatches
      logger.warn("selectBest: no match found — falling back to All", {
        name,
        value,
        normalizedTarget: target,
        availableNormalized: filtered.map(o => ({ text: o.text, normalized: normalize(o.text) })),
      });
      match = options.find(o => o.text.toLowerCase() === "all") ?? null;
    }

    if (match) {
      await sel.evaluate((s: HTMLSelectElement, idx: number) => {
        s.selectedIndex = idx;
        s.dispatchEvent(new Event("change", { bubbles: true }));
      }, match.index);
      logger.info("Selected option", { name, selected: match.text, index: match.index });
    } else {
      logger.warn("No matching option found", { name, value, available: uniqueOpts.map(o => o.text) });
    }
  };

  const fillDateInput = async (input: ReturnType<import("playwright").Frame["locator"]>, dateStr: string, label: string) => {
    const parts = dateStr.split("-");
    const formatted = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : dateStr;
    // Use fill() first — it reliably replaces the entire value
    await input.click({ force: true });
    await input.fill(formatted);
    // Verify it took; if not, fall back to select-all + type
    const actual = await input.inputValue().catch(() => "");
    if (actual !== formatted) {
      await input.click({ clickCount: 3 });
      await input.fill("");
      await input.type(formatted, { delay: 80 });
    }
    await formFrame.locator("body").press("Tab");
    await plannerPage.waitForTimeout(300);
    logger.info("Filled date input", { label, formatted, actual: await input.inputValue().catch(() => "?") });
  };

  const selects = formFrame.locator("select");
  const selectCount = await selects.count();
  let si = 0;

  if (reportConfig.fields.franchise && selectCount > si) {
    const franchiseSelect = selects.nth(si);

    if (config.plannerArea) {
      // Shared-PP branch — use the exact configured Franchise name
      await selectBest(franchiseSelect, config.plannerArea, "Franchise");
    } else {
      // Solo branch — pick the first option that isn't "All" and isn't a live-in-care variant.
      // This avoids relying on URL-slug guessing (which falls back to "All" when it doesn't match).
      const liveInCareRe = /live[\s-]?in[\s-]?care/i;
      const allOptions = await franchiseSelect.locator("option").allTextContents();
      const candidate = allOptions.find(
        (opt) => opt.trim().toLowerCase() !== "all" && !liveInCareRe.test(opt)
      );
      if (candidate) {
        await franchiseSelect.selectOption({ label: candidate.trim() });
        logger.info("Selected option", { name: "Franchise", selected: candidate.trim(), method: "first-non-all" });
      } else {
        logger.warn("No suitable Franchise option found for solo branch — leaving as All", {
          branchUrl: config.branchUrl,
          options: allOptions,
        });
      }
    }
    await plannerPage.waitForTimeout(1000);
    si++;
  }

  if (reportConfig.fields.area && selectCount > si) {
    // Area is always left as "All" — Franchise selection is the branch filter
    await plannerPage.waitForTimeout(800);
    si++;
  }

  if (reportConfig.fields.type && selectCount > si && config.careGiverType) {
    await selectBest(selects.nth(si), config.careGiverType, "Type");
    await plannerPage.waitForTimeout(800);
    si++;
  }

  if (reportConfig.fields.status && selectCount > si && config.careGiverStatus) {
    await selectBest(selects.nth(si), config.careGiverStatus, "Status");
    await plannerPage.waitForTimeout(800);
    si++;
  }

  if ((reportConfig.fields.startDate || reportConfig.fields.endDate) && config.startDate && config.endDate) {
    const dateInputs = formFrame.locator(
      "input[type='text']:not([readonly]):not([disabled]), input:not([type]):not([readonly]):not([disabled])"
    );
    const dateCount = await dateInputs.count();
    if (reportConfig.fields.startDate && dateCount >= 1) {
      await fillDateInput(dateInputs.nth(0), config.startDate, "Start date");
      await plannerPage.waitForTimeout(400);
    }
    if (reportConfig.fields.endDate && dateCount >= 2) {
      await fillDateInput(dateInputs.nth(1), config.endDate, "End date");
      await plannerPage.waitForTimeout(400);
    }
    await plannerPage.waitForTimeout(600);
  }

  if (reportConfig.fields.includeBankDetails) {
    const cb = formFrame.locator("input[type='checkbox']").first();
    const isChecked = await cb.isChecked().catch(() => false);
    const shouldCheck = config.includeBankDetails === true;
    if (isChecked !== shouldCheck) {
      await cb.click();
      await plannerPage.waitForTimeout(400);
    }
  }

  if (reportConfig.fields.exportType && config.exportType) {
    const selectsNow = formFrame.locator("select");
    const countNow = await selectsNow.count();
    for (let i = 0; i < countNow; i++) {
      const opts = await selectsNow.nth(i).locator("option").allInnerTexts().catch(() => [] as string[]);
      if (opts.some(o => /csv|excel/i.test(o))) {
        await selectBest(selectsNow.nth(i), config.exportType, "Export Type");
        await plannerPage.waitForTimeout(900);
        break;
      }
    }
  }

  if (reportConfig.fields.exportTemplate && config.exportTemplate) {
    const selectsNow = formFrame.locator("select");
    const countNow = await selectsNow.count();
    for (let i = countNow - 1; i >= 0; i--) {
      const opts = await selectsNow.nth(i).locator("option").allInnerTexts().catch(() => [] as string[]);
      if (opts.some(o => o.toLowerCase().includes("template") || o.toLowerCase().includes("export"))) {
        await selectBest(selectsNow.nth(i), config.exportTemplate, "Export Template");
        await plannerPage.waitForTimeout(900);
        break;
      }
    }
  }

  if (reportConfig.fields.careGiverMultiSelect && config.selectAllCareGivers) {
    const multi = formFrame.locator("select[multiple]").first();
    if (await multi.count().catch(() => 0) > 0) {
      const allVals = await multi.locator("option").evaluateAll(opts =>
        opts.map(o => (o as HTMLOptionElement).value).filter(Boolean)
      );
      if (allVals.length > 0) {
        await multi.selectOption(allVals);
        logger.info("Selected all options in multi-select", { count: allVals.length });
        await plannerPage.waitForTimeout(400);
      }
    } else {
      // Fallback: tick all checkboxes (Availability Export renders CG list as checkboxes)
      const checkboxes = formFrame.locator("input[type='checkbox']");
      const cbCount = await checkboxes.count().catch(() => 0);
      if (cbCount > 0) {
        let checked = 0;
        for (let i = 0; i < cbCount; i++) {
          const isChecked = await checkboxes.nth(i).isChecked().catch(() => false);
          if (!isChecked) {
            await checkboxes.nth(i).check({ force: true }).catch(() => {});
            checked++;
          }
        }
        logger.info("Checked care giver checkboxes", { total: cbCount, alreadyChecked: cbCount - checked });
        await plannerPage.waitForTimeout(500);
      }
    }
  }

  await plannerPage.waitForTimeout(500);
}

// ─── Trigger download ─────────────────────────────────────────────────────────
async function triggerDownload(plannerPage: Page, jobId: string): Promise<string> {
  const formFrame = await getReportFormFrame(plannerPage);
  const isReportViewer = await formFrame.locator("form#ReportViewer").count().catch(() => 0) > 0;

  let responseResolved = false;
  let downloadEventResolved = false;

  const downloadEventPromise: Promise<{ source: "event"; path: string }> = plannerPage
    .waitForEvent("download", { timeout: 90000 })
    .then(async (download) => {
      downloadEventResolved = true;
      const fname = download.suggestedFilename() || `export-${jobId}.xlsx`;
      const savePath = path.join(DOWNLOAD_DIR, `${jobId}-${fname}`);
      await download.saveAs(savePath);
      return { source: "event" as const, path: savePath };
    });

  const responsePromise: Promise<{ source: "response"; path: string }> = new Promise((resolve, reject) => {
    const FILE_TYPES = [
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/octet-stream",
      "text/csv",
    ];
    const handler = async (response: import("playwright").Response) => {
      if (downloadEventResolved || responseResolved) return;
      try {
        const headers = await response.allHeaders();
        const ct = (headers["content-type"] || "").toLowerCase();
        const cd = (headers["content-disposition"] || "").toLowerCase();
        // Match: attachment OR known file MIME OR filename ending in .xls/.xlsx/.csv
        const hasExcelFilename = /filename[^;=\n]*=.*\.(xlsx?|csv)/i.test(cd);
        if (!cd.includes("attachment") && !hasExcelFilename && !FILE_TYPES.some(t => ct.includes(t))) return;

        responseResolved = true;
        plannerPage.off("response", handler);

        const buffer = await response.body();
        const suggested = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)?.[1]?.replace(/['"]/g, "").trim()
          || `export-${jobId}.xlsx`;
        const savePath = path.join(DOWNLOAD_DIR, `${jobId}-${suggested}`);
        fs.writeFileSync(savePath, buffer);
        resolve({ source: "response" as const, path: savePath });
      } catch {
        // non-fatal
      }
    };
    plannerPage.on("response", handler);
    setTimeout(() => {
      plannerPage.off("response", handler);
      if (!downloadEventResolved && !responseResolved) {
        reject(new Error("No file download detected within 90 seconds"));
      }
    }, 91000);
  });

  // Collect image buttons — log only the action buttons (not per-row delete buttons)
  const allImageBtns = await formFrame.locator("input[type='image']").evaluateAll(els =>
    els.map(el => ({ name: (el as HTMLInputElement).name, id: el.id, src: (el as HTMLInputElement).src?.split("/").slice(-1)[0] ?? "" }))
  ).catch(() => [] as { name: string; id: string; src: string }[]);
  const actionBtns = allImageBtns.filter(b => !b.name.includes("$btnDataGridTemplateDelete"));
  logger.info("Image buttons on form", { total: allImageBtns.length, actionButtons: actionBtns, isReportViewer });

  // Helper: try all image buttons matching a selector, click first visible
  const clickFirstVisible = async (candidates: ReturnType<import("playwright").Frame["locator"]>[], label: string): Promise<boolean> => {
    for (const loc of candidates) {
      const count = await loc.count().catch(() => 0);
      if (count === 0) continue;
      for (let i = 0; i < count; i++) {
        const btn = loc.nth(i);
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click({ force: true });
          logger.info("Clicked export button", { label, index: i });
          return true;
        }
      }
    }
    return false;
  };

  if (isReportViewer) {
    // Try ASP.NET postback first
    const postbackDone = await formFrame.evaluate(() => {
      type BrowserWindowWithPostBack = Window & { __doPostBack?: (target: string, arg: string) => void };
      const win = window as BrowserWindowWithPostBack;
      if (typeof win.__doPostBack === "function") {
        try { win.__doPostBack("ReportViewer", "Export$Excel"); return true; } catch { return false; }
      }
      return false;
    }).catch(() => false);

    if (!postbackDone) {
      const clicked = await clickFirstVisible([
        formFrame.locator("input[type='image'][name='btnReport']"),
        formFrame.locator("input[type='image'][name*='Export']"),
        formFrame.locator("input[type='image'][name*='export']"),
        formFrame.locator("input[type='image'][src*='xls']"),
        formFrame.locator("input[type='image'][src*='Excel']"),
        formFrame.locator("input[type='image'][src*='export']"),
        formFrame.locator("a, button").filter({ hasText: /excel|export|download/i }),
        formFrame.locator("input[type='image']"),  // catch-all: any image button
      ], "ReportViewer-fallback");

      if (!clicked) throw new Error("Could not trigger export on Report Viewer form");
    }
  } else {
    const clicked = await clickFirstVisible([
      formFrame.locator("input[type='image'][name='btnExport']"),
      formFrame.locator("input[type='image']#btnExport"),
      formFrame.locator("input[type='image'][onclick*='DoDetailValidate']"),
      formFrame.locator("input[type='image'][src*='DetailExportButton']"),
      formFrame.locator("input[type='image'][name*='Export']"),
      formFrame.locator("input[type='image'][src*='xls']"),
      formFrame.locator("input[type='image'][src*='Excel']"),
      formFrame.locator("input[type='image'][src*='export']"),
      formFrame.locator("a, button").filter({ hasText: /excel|export|download/i }),
      formFrame.locator("input[type='image']"),  // catch-all: any image button
    ], "standard-export");

    if (!clicked) throw new Error("Could not find visible export button.");
  }

  const result = await Promise.race([downloadEventPromise, responsePromise]).catch(err => {
    throw new Error(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  logger.info("Download completed", { source: result.source, path: result.path });
  return result.path;
}

// ─── Session pre-warming ──────────────────────────────────────────────────────
/**
 * Pre-warm all configured account slot sessions.
 *
 * For each slot, this function:
 *  1. Acquires (or reuses) the shared Chromium browser.
 *  2. Creates a BrowserContext loaded from the saved session file (if present),
 *     so returning users skip the login form entirely.
 *  3. Navigates to the Access Cloud login URL to verify the session is still live.
 *  4. Logs in and saves a fresh session file only when the session has expired.
 *  5. Closes the temporary page — the context stays open so runJob can reuse it.
 *
 * This is fire-and-forget background work. Failures are logged but not thrown.
 * Called once at worker startup so the first user-triggered sync is instant.
 */
export async function prewarmAllSlots(): Promise<void> {
  if (slotStates.length === 0) {
    logger.info("Session pre-warm: no account slots configured — skipping");
    return;
  }

  logger.info("Session pre-warm: starting for all slots", { slotCount: slotStates.length });

  const results = await Promise.allSettled(
    slotStates.map(async (slot) => {
      try {
        // Reuse existing context if already warm from a previous pre-warm or job.
        if (slot.context && !slot.context.browser()?.isConnected() === false) {
          logger.info("Session pre-warm: slot already has a context — skipping", { slotIndex: slot.index });
          return;
        }

        const browser = await getOrLaunchSharedBrowser();

        if (!slot.context) {
          slot.context = await browser.newContext({
            storageState: fs.existsSync(slot.sessionFile) ? slot.sessionFile : undefined,
            acceptDownloads: false,
          });
          slot.plannerPage = null;
        }

        const page = await slot.context.newPage();

        try {
          await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

          const needsLogin = await checkNeedsLogin(page);
          if (needsLogin) {
            logger.info("Session pre-warm: cold session — logging in", { slotIndex: slot.index });
            await login(page, slot.email, slot.password);
            await slot.context.storageState({ path: slot.sessionFile });
            logger.info("Session pre-warm: login complete, session saved", { slotIndex: slot.index });
          } else {
            logger.info("Session pre-warm: session still warm — no login needed", { slotIndex: slot.index });
            // Refresh the saved session file with the latest cookies.
            await slot.context.storageState({ path: slot.sessionFile });
          }
        } finally {
          await page.close().catch(() => {});
        }
      } catch (err) {
        logger.error("Session pre-warm: slot failed", err instanceof Error ? err : undefined, {
          slotIndex: slot.index,
          error: err instanceof Error ? err.message : String(err),
        });
        // On failure, discard the context so runJob starts fresh for this slot.
        if (slot.context) {
          await slot.context.close().catch(() => {});
          slot.context = null;
          slot.plannerPage = null;
        }
        // Re-throw so Promise.allSettled records this slot as rejected and the
        // summary counts (succeeded / failed) are accurate.
        throw err;
      }
    })
  );

  const succeeded = results.filter(r => r.status === "fulfilled").length;
  const failed = results.filter(r => r.status === "rejected").length;
  logger.info("Session pre-warm: complete", { succeeded, failed, total: slotStates.length });
}
