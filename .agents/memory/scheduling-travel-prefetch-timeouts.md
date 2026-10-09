---
name: Scheduling travel prefetch timeouts
description: Large-branch travel requests can disconnect before returning road times and silently leave only walkers eligible.
---

Keep scheduling travel prefetch bounded or use a background job with progress polling; a single long all-pairs request is not reliable through the preview connection.

**Why:** On 2026-10-09, a large-branch prefetch disconnected after approximately two minutes while the server continued processing Mapbox batches. The browser's warning claimed an estimated-travel fallback, but car cache misses were treated as unreachable. The resulting allocation used only walkers. An isolated replay reproduced the saved allocation exactly without a road-travel cache. The database save itself returned HTTP 200.

**How to apply:** When a large schedule allocates unexpectedly few visits, check whether road times reached the browser and inspect assigned carers' transport modes before changing capacity, availability, gender, or travel safety rules. Distinguish generation/travel failures from persistence failures. Preserve real road-time routing; do not silently represent estimated or missing travel times as successful live routing.
