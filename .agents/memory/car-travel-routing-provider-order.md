---
name: Free routing policy
description: User-approved free-routing policy, provider quota units and safeguards required across scheduling and enquiries.
---

Scheduling and enquiries must stay within free routing allowances. Use ORS
Matrix for bulk checks, ORS Directions for individual routes and quota-guarded
Mapbox Directions for small-route backup. Mapbox Matrix must not be used,
including as an automatic fallback.

**Why:** The user observed chargeable Mapbox matrix usage and explicitly asked
to avoid further paid routing. They subsequently authorized utilizing both
Directions APIs within their free allowances, not restoring paid Matrix usage.
This supersedes the earlier Mapbox-first enquiry/Mapbox-matrix-backup decisions.

**How to apply:** Never re-enable paid matrix fallback without explicit
approval. Preserve bounded requests, provider deadlines and fail-closed travel
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

ORS has also returned zero remaining on a successful Matrix response while
the account dashboard still showed available quota. This is a documented
provider-header inconsistency, not evidence that routing must stop.

**Why:** Proactively applying its reset timestamp caused a false next-day
block even though all upstream requests succeeded.

**How to apply:** Do not establish quota cooldowns from successful-response
remaining headers. Keep the shared budget ledger and respect actual HTTP 429
responses. See https://ask.openrouteservice.org/t/x-ratelimit-remaining-returns-wrong-number/2121.

**How to apply:** Check https://openrouteservice.org/plans/ and
https://openrouteservice.org/restrictions/ for plan limits. Treat actual 429/reset
headers as cooldown instructions, not proof of remaining daily allowance.

Use the current ORS gateway, `api.heigit.org`, not the deprecated
`api.openrouteservice.org`.

**Why:** ORS reduced the legacy gateway's quotas; its dashboard displays the
new gateway's allowances instead. Legacy quota errors can therefore occur
while the dashboard appears to have full quota. ORS staff confirmed this at
https://ask.openrouteservice.org/t/quota-exceeded-on-directions-while-dashboard-shows-full-quota-standard-key/8068/2.

**How to apply:** Verify the gateway before interpreting quota discrepancies.
The new route base includes `/openrouteservice/v2/`, not just `/v2/`;
follow https://ask.openrouteservice.org/t/deprecating-api-openrouteservice-org-in-favour-of-api-heigit-org/7912.
An endpoint migration does not replenish an account-wide free budget; preserve
the ledger and only clear a cooldown proven to originate from the old gateway.

Do not reintroduce persistent travel-time caching without approval. Fresh
road lookups can share an isolated cache within one enquiry run, including its
multiple weeks, but not between concurrent users or completed runs.

**Why:** The user previously rejected persistent enquiry travel caching after
incorrect matcher behavior; see enquiry-matcher-travel-cache-reverted.md.
