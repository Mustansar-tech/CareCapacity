# People Planner automation reliability

## Account policy

Care Capacity (single- and multi-week) and BI Financial Summary share the same
account ownership and fallback rules. The current branch mapping groups franchises
under five dedicated accounts; the two universal accounts are global fallbacks.
Never repeatedly retry a failed account within a session. A busy account is not a
failed account: wait for ownership or use another free permitted backup.

## Safeguards

- PostgreSQL leases coordinate the **actual login identity**, not just a slot
  number, across the API and cron worker. Only a SHA-256 identity digest, random
  owner reference and expiry are stored—no credentials or report contents.
- Ownership renews every 15 seconds with a 120-second expiry. Failed or uncertain
  renewal closes the browser and fails safely. Crashed owners expire; stale owners
  cannot release a replacement's lease. This uses ordinary SQL and works with
  transaction pooling, not session-scoped advisory locks.
- Keep one account session across a branch's reports, weeks and BI franchise
  selections. Close its pages before releasing the lease.
- A dedicated-account failure tries the remaining universal accounts once each,
  including when preparation of the first backup fails. A mail outage cannot
  indefinitely block the next attempt.
- Browser launch rejection is not cached indefinitely. Startup warms Chromium
  without logging into accounts. Cookies are private to the account identity and
  process; a failed session's saved cookies are discarded.
- Both cron paths stagger branch starts. Both local queues are woken on release,
  and a blocked branch does not prevent another ready branch from starting.
- Attempt alerts provide a safe failure category, not a claim of bad credentials.
  A separate final email reports recovery, partial completion or failure.
- Partially completed branches are not reported as fully completed. BI totals
  count missing/unfinished exports as unsuccessful refreshes at its reporting
  deadline, even if they have not yet returned an explicit failure.

## Rollout

1. Apply `migrations/20261027_pp_automation_account_leases.sql` to the same
   existing PostgreSQL/Supabase database used by **both** services. It adds one
   coordination table and enables RLS; no existing business tables are changed.
   The server database role needs access; browser/anonymous roles must not.
2. Run `npx tsx scripts/verify-pp-account-leases.ts`. It launches a separate test
   process and uses only a random temporary lock, never a real PP account.
3. Let current exports finish (or deliberately stop them), then deploy the same
   build to **both** `care-capacity-api` and `care-capacity-worker`. A mixed
   old/new deployment is not protected: old instances do not acquire leases.
4. Confirm both services are healthy and the worker logs both cron schedules.
5. Observe a complete Care Capacity and BI run. Check requested item counts,
   final outcomes and saved-data timestamps—not just attempt-level emails.

The Replit preview restart does not update an external VPS or restart its cron
worker. All preview/staging instances using these real accounts must also use
the same coordination database or avoid running automation.

## Verification without provider side effects

```sh
npx tsx --test tests/server/pp-export-job-fallback.node-test.ts tests/server/pp-account-lease.node-test.ts
npx vitest run tests/unit/pp-browser-recovery.test.ts
npm run check
npm run build
```

## Limits that remain

No application can guarantee People Planner, Access Workspace, the network or
the database will never fail. Password expiry, permissions, interactive sign-in
challenges and provider UI changes can still require intervention; do not bypass
challenges or hammer failed accounts.

Account locks recover after a process crash, but the in-memory branch queue does
**not** resume unfinished work automatically after a restart. Persisted,
idempotent job checkpoints/recovery and an independent missed-run/freshness
monitor are the next reliability layers. This change does not claim to provide
those. Notification delivery is bounded and logged but is not a durable mail
outbox.
