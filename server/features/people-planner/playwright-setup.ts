/**
 * Ensures a Chromium executable is available before automation jobs run.
 *
 * Strategy (in order):
 *  1. If a system Chromium is on PATH (via nix pkgs.chromium), use it — no
 *     download needed, the nix packages provide all required system libs.
 *  2. If the Playwright-managed binary already exists on disk, nothing to do.
 *  3. Otherwise run `npx playwright install chromium` (no --with-deps because
 *     nix packages already supply the system libraries).
 */
import { exec, execSync } from "child_process";
import fs from "fs";
import { logger } from "../../infrastructure/logger";

let installPromise: Promise<void> | null = null;

function findSystemChromium(): string | undefined {
  const candidates = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  try {
    const p = execSync(
      "which chromium-browser 2>/dev/null || which chromium 2>/dev/null || echo ''",
      { encoding: "utf-8", timeout: 5000 }
    ).trim();
    if (p) return p;
  } catch {
    // ignore
  }
  return undefined;
}

function findPlaywrightBinary(): string | undefined {
  // Playwright stores managed binaries under PLAYWRIGHT_BROWSERS_PATH or
  // the default ~/.cache/ms-playwright path.
  const cacheRoot =
    process.env.PLAYWRIGHT_BROWSERS_PATH ||
    `${process.env.HOME || "/home/runner"}/.cache/ms-playwright`;
  try {
    if (!fs.existsSync(cacheRoot)) return undefined;
    // Look for any chrome-headless-shell binary under the cache
    const dirs = fs.readdirSync(cacheRoot);
    for (const dir of dirs) {
      if (!dir.startsWith("chromium")) continue;
      const candidates = [
        `${cacheRoot}/${dir}/chrome-headless-shell-linux64/chrome-headless-shell`,
        `${cacheRoot}/${dir}/chrome-linux/chrome`,
        `${cacheRoot}/${dir}/chromium-linux64/chrome`,
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}

function runInstall(): Promise<void> {
  // Check system chromium first — if present we don't need to download anything
  const systemChromium = findSystemChromium();
  if (systemChromium) {
    logger.info(`playwright-setup: system Chromium found at ${systemChromium} — skipping download.`);
    return Promise.resolve();
  }

  // Check Playwright-managed binary
  const existingBinary = findPlaywrightBinary();
  if (existingBinary) {
    logger.info(`playwright-setup: Playwright Chromium already at ${existingBinary} — skipping download.`);
    return Promise.resolve();
  }

  // Download the browser binary.
  // No --with-deps: nix packages in replit.nix already supply system libs.
  logger.info("playwright-setup: Chromium not found — downloading via Playwright...");
  return new Promise((resolve) => {
    const child = exec(
      "npx playwright install chromium",
      { timeout: 300_000 },
      (err) => {
        if (err) {
          logger.warn("playwright-setup: install finished with warnings", {
            message: err.message.slice(0, 300),
          });
        } else {
          logger.info("playwright-setup: Chromium downloaded successfully.");
        }
        resolve();
      }
    );
    child.stdout?.on("data", (d: string) => {
      const line = d.toString().trim();
      if (line) logger.info(`playwright-setup: ${line}`);
    });
    child.stderr?.on("data", (d: string) => {
      const line = d.toString().trim();
      if (line) logger.info(`playwright-setup: ${line}`);
    });
  });
}

/**
 * Starts the Playwright install check in the background.
 * Safe to call multiple times — only runs once per process.
 */
export function ensurePlaywrightBrowser(): void {
  if (!installPromise) {
    installPromise = runInstall();
  }
}

/**
 * Waits for the browser check/install to complete.
 * Automation jobs call this before launching the browser.
 */
export async function waitForPlaywrightBrowser(): Promise<void> {
  if (!installPromise) {
    installPromise = runInstall();
  }
  await installPromise;
}
