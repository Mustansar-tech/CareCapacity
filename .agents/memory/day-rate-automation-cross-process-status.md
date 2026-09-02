---
name: Day Rate automation cross-process status + retry
description: Why the Financial Summary automation status banner showed "not yet run" despite successful cron runs, and how reliability was hardened.
---

## Root cause: two PM2 processes, one in-memory state

`care-capacity-api` (serves HTTP routes) and `care-capacity-worker` (runs cron via `worker.ts`) are **separate PM2 processes**, each with its own module-level JS state. Any automation status/history kept in a plain in-memory variable inside a routes file is invisible across the process boundary: the worker's cron run updates its own copy, the API process serving the status endpoint never sees it. Manual "run now" clicks worked because that request executes inside the API process itself.

**Why this matters generally:** any future automation/status feature that must be visible from the API needs to persist to Postgres (or another shared store), not module-level variables — this is a recurring trap in this app's two-process architecture, not a one-off bug.

**How it was fixed:** added `day_rate_automation_runs` / `day_rate_automation_job_results` tables; the cron creates a run row, each job result is persisted as it finishes, and `GET /api/day-rate/automation/status` reads from the DB (`getLatestAutomationRun()`) instead of in-memory state.

## Secondary cause: unstaggered cold-login concurrency

At the 2am cron fire, ~10 branches' Playwright sessions all attempted AccessCloud login/launcher navigation near-simultaneously (up to 6 concurrent slots), intermittently exceeding fixed 30s timeouts. This was a transient contention issue, not a business-logic bug, and there was no retry — one flaky login permanently dropped that franchise/month for the day.

**Fix:** per-job retry (up to 3 attempts, 8s backoff) for a curated list of retryable/transient error patterns (timeouts, "tile not found", ERR_*, download-not-detected), plus a 15s stagger between branch kickoffs in the scheduler loop.
