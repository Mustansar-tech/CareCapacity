---
name: Scheduling travel prefetch timeouts
description: Large-branch travel requests can disconnect before returning road times and silently leave only walkers eligible.
---

Keep scheduling travel prefetch bounded or use a background job with progress polling; a single long all-pairs request is not reliable through the preview connection.

Do not carry Mapbox's smaller coordinate limit into ORS-only bulk routing.

**Why:** After the user chose free-only routing, ORS-sized bounded matrices
substantially reduced requests per schedule without holding the entire
generation open as one browser request.

**How to apply:** Check the active provider's element limit before changing
batch sizes; keep individual upstream requests timed and fail closed on
incomplete responses. Refer to car-travel-routing-provider-order.md for the
current free-routing policy.

**Why:** On 2026-10-09, a large-branch prefetch disconnected after approximately two minutes while the server continued processing Mapbox batches. The browser's warning claimed an estimated-travel fallback, but car cache misses were treated as unreachable. The resulting allocation used only walkers. An isolated replay reproduced the saved allocation exactly without a road-travel cache. The database save itself returned HTTP 200.

**How to apply:** When a large schedule allocates unexpectedly few visits, check whether road times reached the browser and inspect assigned carers' transport modes before changing capacity, availability, gender, or travel safety rules. Distinguish generation/travel failures from persistence failures. Preserve real road-time routing; do not silently represent estimated or missing travel times as successful live routing.

Prefer stateless bounded requests for browser-driven prefetch over a process-local background polling job.

**Why:** This avoids requiring requests to reach the same API process or introducing a new persistent job/cache layer. Request-local routing caches also prevent unrelated matcher/debug requests from clearing an in-progress schedule's shared cache.

**How to apply:** Keep provider deadlines opt-in for this scheduling path, preserving other travel consumers. A provider outage must stop generation without replacing the saved schedule; a valid provider matrix containing null routes must instead keep those pairs unreachable under the existing scheduling rules.
