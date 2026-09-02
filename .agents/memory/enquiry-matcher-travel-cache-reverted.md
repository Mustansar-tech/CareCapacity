---
name: Enquiry matcher travel cache reverted
description: A persistent DB-backed travel-time cache was added to the BD/enquiry matcher and then reverted at the user's request.
---

A commit added a 21-day persistent DB cache for ORS travel times used by the BD/enquiry matcher (hydrate-on-first-use per branch per process, bulk upsert of ORS Matrix results, `orsMatrixBatch()` requiring a `branchId` arg). The user reported the matcher "behaving" wrong afterward and asked to remove it entirely rather than debug/tune it.

**What was reverted:** `server/features/travel/travel-time-service.ts` (hydrateDbCache, CACHE_TTL_DAYS, TRUSTED_CAR_SOURCES, DB persistence in `orsMatrixBatch`), `server/repositories/geo.repository.ts` (`getFreshTravelTimes`/`saveTravelTimesBulk`), `server/storage.ts` interface/impl additions, and the `branchId` parameter threaded into `orsMatrixBatch`/`refineReturnHomeTravelWithORS` call sites in `bd-matcher.controller.ts`, `bd-matcher.service.ts`, `bdMatcher.ts`.

**Why:** User-reported regression in matcher behavior traced to the newly-introduced persistent cache; user explicitly wanted a clean revert rather than a fix-in-place, to restore known-good prior behavior.

**How to apply:** Do not reintroduce a persistent (cross-process/cross-run) travel-time cache for the enquiry/BD matcher without explicit user sign-off — the matcher should keep hitting ORS live per run. The existing in-memory per-request `_sessionCache` in `TravelTimeService` was untouched and still dedupes calls within a single matcher run.
