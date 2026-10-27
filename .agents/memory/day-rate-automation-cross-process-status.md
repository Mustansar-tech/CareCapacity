---
name: Automation cross-process coordination
description: Why API and cron state and account ownership must be shared, and why rollout must cover both services.
---

Automation state visible from HTTP and account ownership must be shared across API
and cron processes, not held only in module-level memory.

**Why:** successful cron work previously appeared as "not yet run" to HTTP users
because each process saw a different state. Local account reservations likewise
cannot prevent another process from using the same provider login.

**How to apply:** coordinate actual account identities through the shared database.
Use expiring owner-checked leases, not session-scoped advisory locks (transaction
pooling must work). Treat uncertain ownership as a reason to stop browser work,
not as permission to bypass coordination with another account.

Do not authenticate accounts during unreserved startup pre-warming.

**Why:** a worker restart must not invalidate an active API session. Simultaneous
cold logins also create avoidable provider and browser contention.

**How to apply:** warm the browser only; acquire account ownership before any login.
Stagger branch starts. Preserve the single-attempt fallback policy in
`pp-automation-universal-fallback.md`; do not restore older same-account retry loops.

A preview restart is not an external VPS rollout. All processes sharing the
accounts must adopt the coordination rules and use the same database.

**Why:** an old worker ignores leases held by a new API. A mixed-version deployment
therefore cannot provide exclusive account access.

**How to apply:** drain active exports and update both services together. Do not
claim live recovery merely because isolated tests and the preview pass.
