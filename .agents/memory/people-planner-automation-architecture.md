---
name: People Planner automation architecture
description: Where the real daily/weekly PP automation scheduler lives, and how to add a new export type to the declarative automation-engine.
---

## The real armed scheduler is `server/worker.ts`, not `scheduler.ts`

`server/features/people-planner/scheduler.ts` (`initScheduler`/`destroyScheduler`) is dead code — never imported or called anywhere. The actual PM2-managed cron process is `server/worker.ts`, using `node-cron` with `Europe/London` timezone. Any new daily/weekly PP automation must be wired into `worker.ts`, not `scheduler.ts`. Before assuming a scheduler file is "the" scheduler, grep for where it's actually imported/started.

## Adding a new PP export type to the automation engine

The architecture is `report-configs.ts` (declarative `REPORT_CONFIGS` entry + menuPath) → `automation-engine.ts` (`navigateToExport`, form-filling, `triggerDownload`) → `automation-routes.ts` (slot-reservation session runner + HTTP routes).

**Why:** keeps every export type in one declarative table instead of bespoke Playwright scripts per report, and reuses the shared 6-account slot-reservation/queueing system so concurrent automations never open two browser sessions on the same PP tenant.

**How to apply:**
- Most menus are pure hover-flyouts, walked generically by `menuPath` (hover every step except the final one, which is clicked). If a menu path has a page you must actually *click* to load (not just hover) before revealing further hover flyouts — e.g. Finance's top-level tab bar — you must special-case that `reportType` inside `navigateToExport` with explicit click/hover/click steps; the generic walker can't express "click, then hover, then click".
- The `selectBest` dropdown-matcher excludes "Live in care" text by default (correct for Area-style filters that never target LIC rows). If a new export's Franchise/Area field must target an exact Live-In-Care sub-entity row, add an explicit opt-out param rather than changing the default.
- Multiple franchise rows can share one PP tenant/browser slot (e.g. a branch's main + Live-In Care entities). Run all jobs for one tenant sequentially inside a single login session (mirrors `runMultiWeekPipelineSession`'s login-once/iterate/logout shape) rather than opening a fresh session per franchise row.
