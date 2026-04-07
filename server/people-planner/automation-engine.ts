import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { logger } from "../logger";
import type { ReportType } from "./report-configs";
import { getReportConfig } from "./report-configs";

export interface JobConfig {
  /** Direct Access Workspace URL for this branch, e.g. https://go.accessacloud.com/o/home-instead-uk-ayr-kilmarnock/ */
  branchUrl: string;
  /** Optional People Planner area name (leave blank to use form default) */
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
const SESSION_FILE = path.resolve("/tmp/pp-access-session.json");
const DEBUG_DIR = path.resolve(process.cwd(), "pp-debug-screenshots");
const LOGIN_URL = "https://identity.accessacloud.com/auth/signin?force=true&setemail=false&settenant=false";
const WORKSPACE_URL = "https://go.accessacloud.com/";

// ─── State ────────────────────────────────────────────────────────────────────
const jobs = new Map<string, AutomationJob>();
let currentJobId: string | null = null;
const jobQueue: AutomationJob[] = []; // enqueue full job objects to preserve IDs
let isProcessingQueue = false;

// Shared browser resources reused across all queued jobs in one session
let sharedBrowser: Browser | null = null;
let sharedContext: BrowserContext | null = null;
let sharedPlannerPage: Page | null = null;

ensureDir(DOWNLOAD_DIR);

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
export function getJob(id: string): AutomationJob | undefined {
  return jobs.get(id);
}

export function listJobs(): AutomationJob[] {
  return Array.from(jobs.values())
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 20);
}

export function getCurrentJob(): AutomationJob | null {
  if (!currentJobId) return null;
  return jobs.get(currentJobId) ?? null;
}

export function isRunning(): boolean {
  const job = getCurrentJob();
  return job?.status === "running" || job?.status === "pending";
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

export async function runAutomationJob(config: JobConfig): Promise<string> {
  ensureDir(DOWNLOAD_DIR);

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

  if (!isRunning()) {
    currentJobId = id;
    runJob(job).catch((err) => {
      logger.error("Unhandled automation error", err, { jobId: id });
    }).finally(() => {
      setImmediate(() => processNextQueuedJob());
    });
  } else {
    // Push the full job object so the ID is preserved when the queue drains
    jobQueue.push(job);
    logger.info("Job queued for sequential processing", { jobId: id, queueLength: jobQueue.length });
  }

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

// ─── Queue processor ─────────────────────────────────────────────────────────
async function processNextQueuedJob(): Promise<void> {
  if (jobQueue.length === 0 || isProcessingQueue) return;

  isProcessingQueue = true;
  const job = jobQueue.shift(); // already registered in `jobs` map with correct ID
  if (!job) { isProcessingQueue = false; return; }

  currentJobId = job.id;

  await runJob(job).catch((err) => {
    logger.error("Unhandled automation error", err instanceof Error ? err : undefined, { jobId: job.id });
  }).finally(() => {
    isProcessingQueue = false;
    setImmediate(() => processNextQueuedJob());
  });
}

// ─── Core job runner ─────────────────────────────────────────────────────────
async function runJob(job: AutomationJob): Promise<void> {
  job.status = "running";
  addLog(job, "Starting automation...");

  const email = process.env.ACCESS_EMAIL;
  const password = process.env.ACCESS_PASSWORD;
  if (!email || !password) {
    job.status = "failed";
    job.error = "ACCESS_EMAIL and ACCESS_PASSWORD environment variables are not set";
    job.completedAt = new Date().toISOString();
    addLog(job, `Failed: ${job.error}`);
    currentJobId = null;
    return;
  }

  try {
    // ── Launch / reuse browser ──────────────────────────────────────────────
    if (!sharedBrowser || !sharedBrowser.isConnected()) {
      addLog(job, "Launching browser...");
      const executablePath = getChromiumExecutablePath();
      sharedBrowser = await chromium.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        ...(executablePath ? { executablePath } : {}),
      });
      sharedContext = null;
      sharedPlannerPage = null;
    }

    // ── Create / reuse browser context ─────────────────────────────────────
    if (!sharedContext) {
      sharedContext = await sharedBrowser.newContext({
        storageState: fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined,
        acceptDownloads: true,
      });
      sharedPlannerPage = null;
    }

    // ── Step 1: Login ─────────────────────────────────────────────────────
    // ── Step 2: Navigate to branch URL to select the branch ───────────────
    // ── Step 3: Open People Planner from the Access launcher ─────────────
    let plannerPage: Page;
    if (!sharedPlannerPage || sharedPlannerPage.isClosed()) {
      const workspacePage = await sharedContext.newPage();
      const branchUrl = job.config.branchUrl;

      // Step 1 — Always go to login page first
      addLog(job, "Navigating to Access Workspace login...");
      await workspacePage.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await workspacePage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

      const needsLogin = await checkNeedsLogin(workspacePage);
      if (needsLogin) {
        addLog(job, "Logging in with credentials...");
        await login(workspacePage, email, password);
        await sharedContext.storageState({ path: SESSION_FILE });
        addLog(job, "Login successful, session saved.");
      } else {
        // force=true in LOGIN_URL normally always shows the form;
        // if we land elsewhere the saved session is still valid
        addLog(job, "Active session detected — skipping login form.");
      }

      // Step 2 — Navigate directly to the branch URL to select the branch
      addLog(job, `Selecting branch via URL: ${branchUrl}`);
      await workspacePage.goto(branchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await workspacePage.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

      // Step 3 — Open People Planner from the launcher
      addLog(job, "Opening People Planner from the Access launcher...");
      sharedPlannerPage = await openPeoplePlanner(sharedContext, workspacePage);
      addLog(job, "People Planner opened.");
    } else {
      addLog(job, "Reusing existing People Planner session.");
    }

    plannerPage = sharedPlannerPage;

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

    await sharedContext.storageState({ path: SESSION_FILE });

    job.status = "completed";
    job.completedAt = new Date().toISOString();
    job.downloadReady = true;
    job.fileName = cleanName;
    job.filePath = savedFile;
    addLog(job, `Download complete: ${cleanName}`);
    logger.info("Job completed", { jobId: job.id, cleanName, savedFile });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.status = "failed";
    job.error = message;
    job.completedAt = new Date().toISOString();
    addLog(job, `Error: ${message}`);
    logger.error("Automation job failed", err instanceof Error ? err : undefined, { jobId: job.id });

    if (sharedPlannerPage && !sharedPlannerPage.isClosed()) {
      await debugScreenshot(sharedPlannerPage, `fail-${job.id}`).catch(() => {});
    }

    sharedPlannerPage = null;
    if (sharedContext) {
      await sharedContext.close().catch(() => {});
      sharedContext = null;
    }
    if (sharedBrowser) {
      await sharedBrowser.close().catch(() => {});
      sharedBrowser = null;
    }
  } finally {
    currentJobId = null;
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

  await page.waitForTimeout(3000);

  const framesAfter = page.frames();
  let launcherFrame = framesAfter.find(f =>
    f.url().includes("button-app.production.workspace.accessacloud.com")
  ) ?? null;

  if (!launcherFrame) {
    for (const frame of framesAfter) {
      const hasLauncher = await frame.evaluate(() =>
        !!(document.body?.innerText?.includes("People Planner"))
      ).catch(() => false);
      if (hasLauncher) { launcherFrame = frame; break; }
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
    throw new Error(
      `Could not find EVO launcher iframe. Available frames: ${framesAfter.map(f => f.url()).join(", ")}`
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

    const filtered = uniqueOpts.filter(o => !o.text.toLowerCase().includes("live in care"));
    let candidates = filtered.filter(o => normalize(o.text).includes(target) || target.includes(normalize(o.text)));

    let match = null;
    if (targetOccurrence && candidates.length > 0) {
      match = candidates.find(o => o.occurrenceNumber === targetOccurrence);
    }
    if (!match && candidates.length > 0) match = candidates[0];
    if (!match) match = options.find(o => o.text.toLowerCase() === "all") ?? null;

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
    await input.click({ clickCount: 3 });
    await input.fill("");
    await input.type(formatted, { delay: 80 });
    await formFrame.locator("body").press("Tab");
    logger.info("Filled date input", { label, formatted });
  };

  const selects = formFrame.locator("select");
  const selectCount = await selects.count();
  let si = 0;

  if (reportConfig.fields.franchise && selectCount > si) {
    // Derive a matchable franchise name from the branch URL slug
    // e.g. "home-instead-uk-ayr-kilmarnock" → "ayr kilmarnock"
    const slugMatch = config.branchUrl.match(/\/o\/(home-instead-[^/]+)/);
    const franchiseName = slugMatch
      ? slugMatch[1].replace(/home-instead-uk-/, "").replace(/-/g, " ")
      : "";
    if (franchiseName) {
      await selectBest(selects.nth(si), franchiseName, "Franchise");
    }
    await plannerPage.waitForTimeout(1000);
    si++;
  }

  if (reportConfig.fields.area && selectCount > si) {
    if (!reportConfig.defaults.leaveAreaDefault && config.plannerArea) {
      await selectBest(selects.nth(si), config.plannerArea, "Area");
    }
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
        await plannerPage.waitForTimeout(400);
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
        if (!cd.includes("attachment") && !FILE_TYPES.some(t => ct.includes(t))) return;

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

  if (isReportViewer) {
    const postbackDone = await formFrame.evaluate(() => {
      type BrowserWindowWithPostBack = Window & { __doPostBack?: (target: string, arg: string) => void };
      const win = window as BrowserWindowWithPostBack;
      if (typeof win.__doPostBack === "function") {
        try { win.__doPostBack("ReportViewer", "Export$Excel"); return true; } catch { return false; }
      }
      return false;
    }).catch(() => false);

    if (!postbackDone) {
      const btnReport = formFrame.locator("input[type='image'][name='btnReport']");
      if (await btnReport.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btnReport.click({ force: true });
      } else {
        const exportLink = formFrame.locator("a, button").filter({ hasText: /excel|export|download/i }).first();
        if (await exportLink.isVisible({ timeout: 2000 }).catch(() => false)) {
          await exportLink.click({ force: true });
        } else {
          throw new Error("Could not trigger export on Report Viewer form");
        }
      }
    }
  } else {
    const exportCandidates = [
      formFrame.locator("input[type='image'][name='btnExport']"),
      formFrame.locator("input[type='image']#btnExport"),
      formFrame.locator("input[type='image'][onclick*='DoDetailValidate']"),
      formFrame.locator("input[type='image'][src*='DetailExportButton']"),
    ];

    let clicked = false;
    for (const loc of exportCandidates) {
      if (await loc.count().catch(() => 0) === 0) continue;
      const btn = loc.first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click({ force: true });
        clicked = true;
        break;
      }
    }
    if (!clicked) throw new Error("Could not find visible export button.");
  }

  const result = await Promise.race([downloadEventPromise, responsePromise]).catch(err => {
    throw new Error(`Download failed: ${err instanceof Error ? err.message : String(err)}`);
  });

  logger.info("Download completed", { source: result.source, path: result.path });
  return result.path;
}
