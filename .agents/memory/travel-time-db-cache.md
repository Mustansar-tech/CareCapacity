---
name: Travel time DB cache
description: Persistent (cross-run) ORS travel-time cache design, TTL, and source-trust rules — why it was off and how it's re-enabled.
---

The DB-backed travel time cache (`travel_time_cache` table) was intentionally disabled in a March commit ("Disable travel time caching and clear existing data"), leaving only an in-memory per-run session cache. That meant every scheduling/BD-matcher run re-fetched every route from the ORS API, which was a major contributor to ORS daily quota exhaustion (`403 Quota exceeded`).

Re-enabled with two safety rules so it can't silently go stale the way it might have before:
- **TTL**: cached rows older than `CACHE_TTL_DAYS` (currently 21 days, defined in `travel-time-service.ts`) are never trusted.
- **Source trust**: only `ors` / `ors-matrix` sourced rows are ever loaded from the DB cache — a `heuristic`/haversine-fallback row is never treated as a real route, regardless of recency.

**Why:** roads/postcodes change slowly, so a multi-week TTL is safe and cuts ORS quota usage dramatically across repeat runs, but a heuristic fallback must never be mistaken for a real route once ORS becomes available again.

**How to apply:** the fresh, trusted rows for a branch are bulk-loaded into the in-memory session cache once per branch per process (`hydrateDbCache`), so all existing session-cache lookup call sites benefit for free — don't add a second DB round-trip per pair. Any new call site that does `orsMatrixBatch(...)` must now pass `branchId` as the first argument (signature changed) so results can be persisted back to the DB.
