# Care Capacity / SUR Group BI — 2-Week Handover

Purpose: get you comfortable running day-to-day monitoring and weekly checks
on this platform without needing to ask for help on the routine stuff.
Escalation contact for anything not covered here: the project owner.

---

## What this platform does, in one paragraph

It automatically logs into Access Cloud / People Planner every night, pulls
rota and finance data for every branch, and turns it into the dashboards
under "SUR Group BI" (Data House → Day Rate Tracker, KPI Tracker, Annual
Roadmap, plus Scoreboards). A second background worker process runs the
schedule; the main app just serves the website and API. Nobody should be
manually re-typing numbers into a spreadsheet once this is trusted — that's
the whole point of it.

---

## Daily monitoring (5–10 minutes, every morning)

Do this before anyone in the business starts asking about yesterday's numbers.

1. **Check the workflow/process is up.**
   - In Replit: the `Start application` workflow should show "running" with
     no recent crash in the logs.
   - In production: check PM2 status for both the `api` process and the
     `worker` process — they are separate processes, and the worker is the
     one that actually runs the nightly sync. If the API is up but the
     worker is down, dashboards will look fine but will quietly stop
     updating.

2. **Check last night's People Planner sync actually ran.**
   - The worker fires once per weekday at 01:00 Europe/London and syncs
     every branch's forward weeks (plus the previous week on Mondays).
   - Job status/history is persisted to Postgres (not in-process memory),
     specifically so you can check this from either process. Look at the
     automation status/history table for last night's run per branch —
     confirm it says success, not "stuck running" or "failed".
   - If a branch shows failed or stuck, don't re-trigger it blindly — check
     the "known quirks" section below first, since a few of these are
     recurring and have a known cause.

3. **Spot-check the numbers, don't just check "did it run".**
   - Open Data House → Day Rate Tracker for yesterday. Pick 2–3 branches you
     know well and sanity-check the revenue/day-rate figures look plausible
     (not zero, not frozen at the same value as two days ago).
   - A branch total that stays byte-for-byte identical across multiple days
     while its sub-rows (e.g. Live-In Care) keep changing is the signature
     of a join/aggregation bug, not a real "nothing happened" day — treat it
     as broken, not stable. This exact pattern has occurred before
     (North Lanarkshire's parent total froze while its LIC sub-row kept
     updating correctly) — flag it rather than assuming it's fine.

4. **Check the browser console / server logs for new errors** on the BI
   pages and the People Planner automation pages. New error types (not ones
   you already recognise) are worth flagging even if the page "looks" fine.

---

## Weekly testing round (do this once a week, e.g. Monday morning)

This is deeper than the daily check — it's meant to catch things that don't
show up as an obvious crash.

1. **Run a manual trigger of the weekly sync** (admin-only endpoint:
   `POST /api/pp/trigger-weekly-sync`) in a quiet moment and watch it
   complete for all branches. This exercises login, session handling, and
   multi-week iteration in one go — most real failures show up here first.

2. **Cross-check one full week of Day Rate Tracker numbers** against
   whatever the business considers ground truth that week (a manual export,
   or last week's already-verified dashboard numbers). Look for:
   - Missing branches (a branch that should have a row but doesn't — this
     has happened before when a branch had literally zero activity in the
     period and got filtered out rather than shown as zero).
   - A parent branch total that doesn't match the sum of its own sub-rows.

3. **Run the test suite** (`npm run test`) and read the output, don't just
   check exit code — the auth/security tests in particular were recently
   changed to depend on a live DB lookup (`storage.getUserById`) rather than
   trusting the session, so a regression there usually means someone
   changed session/role logic without updating the mocks.
   > Note: `vitest` may fail to even start in the Replit sandbox itself due
   > to a vite/vitest version mismatch in this environment — that's a known
   > sandbox quirk, not a real test failure. CI is the source of truth for
   > pass/fail.

4. **Check role-based access still behaves correctly** after any auth or
   role change: log in as (or impersonate, if you have a way to) each role
   — `admin`, `operations_director`, `scheduler`, `viewer` — and confirm:
   - `operations_director` can see and edit all of SUR Group BI (Data
     House, KPI Tracker, Annual Roadmap, Scoreboards) but cannot trigger
     People Planner / Financial Summary automation (admin-only).
   - Assigning a new role to a user takes effect **immediately**, without
     them having to log out and back in. This was a real bug (stale role
     cached in the session) — if it comes back, it means someone reverted
     the role-check middleware to trust `req.session.userRole` directly
     instead of re-checking the DB on each request.

5. **Check travel-time lookups still work** (used by the BD/enquiry
   matcher): Mapbox is the primary provider for car routes, ORS is backup.
   There's no cache in front of this — every match hits the provider live —
   so a provider outage or rate limit shows up immediately as slow/failed
   matches, not as stale data. If matches suddenly go slow or start
   erroring, check the Mapbox/ORS API keys and rate limits first.

---

## Known quirks to watch for

These are non-obvious behaviours that look like bugs but aren't (or are
known, understood bugs with a specific fix path) — don't "fix" them without
checking here first:

- **GH (group home) loss credits cross branches.** A carer's home branch is
  set from the CG Data "Branch" column, and loss hours legitimately get
  credited to that home branch even when the shift happened elsewhere. If a
  branch's loss numbers look "too high" relative to its own shifts, this is
  probably why — check the sourcing branch before assuming it's wrong.

- **Enquiry star selections have two possible shapes.** Multi-week
  enquiries store `starredSelections` as `{ byWeek }`; older/legacy data can
  still be a flat map. Any code reading star selections needs to handle
  both — if you see stars not showing for older enquiries, this is the
  first thing to check.

- **Any ingestion-time fix must be applied in three places**, not one:
  manual upload, and both People Planner automation paths. Fixing a data
  bug in only one of the three will make it look fixed in testing while it
  silently persists in the other two paths.

- **Employee identity must always go through the shared name-normalization
  helper.** Ad hoc "just compare the name string" logic will silently
  create duplicate people records for the same employee (e.g. slightly
  different formatting from different source exports).

- **PP Financial Summary franchise dropdown text often doesn't match the
  stored franchise name exactly.** There are hardcoded overrides for this —
  don't "clean up" the overrides or strip punctuation to normalize, it will
  break the mapping for specific franchises that need the exact override.

- **Day Rate Tracker must always show 2 decimal places, never rounded.**
  If you see a whole-number or 1-decimal figure on that dashboard, that's a
  formatting regression, not a data issue.

- **Data House automation status/history is stored in Postgres, not
  in-memory**, specifically because the API and worker are separate
  processes (PM2) and don't share memory. If someone "fixes" a status bug
  by moving state back into a module-level variable, cross-process status
  will silently go stale again.

- **North Lanarkshire dashboard discrepancy (open, known issue as of
  September 2026):** the branch's parent-level revenue/day-rate total can
  freeze at a stale value across several days while its Live-In Care
  sub-row keeps updating correctly — the bug is isolated to how the parent
  total is computed/joined, not the underlying data. This has been
  identified but not yet fixed; don't assume a frozen North Lanarkshire
  total is a new bug, but also don't dismiss it as resolved.

- **Local `db:push` (drizzle) can fail against the Supabase pooler.** If a
  schema push fails with a connection error, it's usually the pooler, not a
  real schema problem — check the SSL/connection override or apply the
  change via direct SQL instead of assuming the migration itself is wrong.

- **Serverless/production DB connections need transaction-mode pooling**
  (port 6543, `pgbouncer=true`), not the 5432 session-mode pooler, which
  caps out around 15 connections project-wide. If you see connection
  exhaustion errors in production specifically, check which pooler mode is
  configured before increasing pool sizes.

---

## What to do if something breaks

1. **Don't panic-fix in production.** Reproduce it first — check logs
   (workflow logs, PM2 logs, browser console) to understand what actually
   failed before changing anything.

2. **Check the obvious things first, in this order:**
   - Is the workflow/process actually running? (Restart it if not, then
     re-check logs — a clean restart that then fails again tells you more
     than logs from a stale process.)
   - Did a secret/API key expire or rotate? (Mapbox, ORS, Resend, Supabase,
     Azure — all live in environment secrets, never hardcode a replacement.)
   - Is it one of the "known quirks" above rather than a new bug?

3. **If it's a data issue (numbers look wrong), isolate it to one layer**
   before touching code:
   - Is the raw source data wrong (check People Planner / Access Cloud
     directly), or is it wrong only in the dashboard (check the
     computation/join)? These need completely different fixes.

4. **If it's an automation/sync failure**, check the persisted job
   status/history first — it will tell you which branch and which step
   failed, rather than guessing from a full log dump.

5. **If you break something while fixing it, or a fix makes things worse,**
   use the checkpoint/rollback history rather than trying to manually
   undo — this project auto-checkpoints the codebase and database, so
   rolling back is safer than reconstructing a previous state by hand.

6. **When in doubt about whether a role/permission or dashboard behaviour
   is "by design" or "a bug", ask before changing it** — several of the
   quirks above look wrong at first glance but are intentional business
   logic (e.g. cross-branch GH loss credits, the franchise dropdown
   overrides).

7. **Escalate immediately (don't attempt a fix) if:**
   - A fix would touch authentication/role logic (auth bugs have a history
     of subtle, security-relevant edge cases here — see the stale-session
     role quirk above).
   - You're not sure whether a discrepancy is a display bug or a real data
     integrity issue affecting decisions already made from the dashboard.

---

## Where to look for more context

- `.agents/memory/` in this repo holds durable lessons and decisions from
  past work on this project (topic files with more detail than this
  document) — worth a skim if you hit something not covered here.
- `docs/internal/` holds compliance/process docs (DPIA, retention schedule,
  breach response) — unrelated to day-to-day monitoring but relevant if a
  data incident occurs.
