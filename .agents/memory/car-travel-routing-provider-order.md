---
name: Free routing policy
description: User-approved free-routing policy, provider quota units and safeguards required across scheduling and enquiries.
---

Scheduling and enquiries must stay within free routing allowances. Use ORS
Matrix for bulk checks, ORS Directions for individual routes and quota-guarded
Mapbox Directions for small-route backup. Mapbox Matrix must not be used
before 1 November 2026, including as an automatic fallback. The user has
authorized making it available from that date, still within free allowances.

**Why:** The user observed chargeable Mapbox matrix usage and explicitly asked
to avoid further paid routing. They subsequently authorized utilizing both
Directions APIs within their free allowances. On 9 October 2026 they authorized
Mapbox Matrix again after 1 November, not further paid Matrix usage.
This supersedes the earlier Mapbox-first enquiry/Mapbox-matrix-backup decisions.

**How to apply:** Never re-enable paid matrix fallback without explicit
approval. The date-based authorization does not waive free-element protection
or confirm the provider's allowance reset; verify those before activation.
Preserve bounded requests, provider deadlines and fail-closed travel
errors; an outage must not silently exclude drivers, substitute car estimates
or save an incomplete match/schedule. Do not fan out a bulk matrix outage into
thousands of Directions calls.

Quota counters must persist and be shared across all branches and processes
using the same allowance. They record attempts/timing, not travel routes,
people's details or credentials.

**Why:** API and worker run separately, restarts cannot replenish a provider's
quota, and concurrent users must not each assume they have the full allowance.

**How to apply:** Reserve usage atomically before dispatch and fail closed if
the guard is unavailable. Use conservative rolling windows and safety
headroom. If multiple deployments use the same keys, their budget ledger must
also be shared. Account usage from other applications is outside an app-only
ledger; do not promise zero account-wide charges without accounting for it.

Compare provider quotas using their actual units.

**Why:** ORS plans count requests, while Mapbox Matrix counts source × destination
elements. Also, live ORS x-ratelimit headers reported a short-window reset and
a limit different from the published daily quota; they are not a reliable
daily-remaining counter.

**How to apply:** Check https://openrouteservice.org/plans/ and
https://openrouteservice.org/restrictions/ for plan limits. Treat actual 429/reset
headers as cooldown instructions, not proof of remaining daily allowance.

Do not reintroduce persistent travel-time caching without approval. Fresh
road lookups can share an isolated cache within one enquiry run, including its
multiple weeks, but not between concurrent users or completed runs.

**Why:** The user previously rejected persistent enquiry travel caching after
incorrect matcher behavior; see enquiry-matcher-travel-cache-reverted.md.
