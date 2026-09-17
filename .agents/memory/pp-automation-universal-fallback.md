---
name: PP automation universal-account fallback
description: How and why the People Planner automation falls back to slot 0 (ACCESS_EMAIL) mid-run when a branch's dedicated account is stuck.
---

A branch's dedicated Access Workspace account can get stuck on the identity/login page during tenant re-auth (observed as a Cloudflare "Verifying..." challenge on that specific account, even though the tenant itself and other accounts on it work fine). Retrying the same account just repeats the failure.

`runExportJobWithRetry` (in `server/features/people-planner/automation-routes.ts`) is the shared retry helper used by all three automation paths — Financial Summary, single-week capacity sync, multi-week capacity sync. On a retryable failure it checks whether slot 0 (`ACCESS_EMAIL`, the universal account with access to every branch) is idle; if so it switches to slot 0 for the remaining attempts/jobs in that session, instead of just retrying the original dedicated slot.

**Why:** confirmed by isolating Glasgow North's failure — its dedicated slot 1 (`ACCESS_EMAIL_1`) hit a Cloudflare challenge that never cleared, while slot 0 logged in and completed the same export in ~60s. The tenant/branch config was never the problem; the specific account was.

**How to apply:** all five/six call sites that reserve/release slots (`programmaticQueueSync`, `programmaticQueueMultiWeekSync`, `programmaticQueueFinancialSummarySync`, their two queue-drain functions, and the manual HTTP run route) must release whichever slot the session actually ended up on (read `session.slotArrayIndex` at release time), not the slot it started on — otherwise a mid-run fallback to slot 0 leaks that reservation. Diagnosing "why does branch X fail but branch Y on the same PP tenant succeed" should start by checking `BRANCH_SLOT_MAP` for a credential-slot difference between the two branches.
