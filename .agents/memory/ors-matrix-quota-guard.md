---
name: ORS Matrix quota guard
description: How the ORS Matrix API's 40/min + 500/day free-tier limits are enforced for the enquiry/BD matcher, and where to look if matches start failing/going heuristic in bulk.
---

The ORS free-tier key used by `TravelTimeService` (server/features/travel/travel-time-service.ts) has two limits shown on the openrouteservice.org dashboard's "Remaining Key Quotas" page for Matrix V2: **40 requests/minute** and **500 requests/day**.

Previously each `orsMatrixBatch()` call just did a local `setTimeout(1500ms)` before firing — this only self-throttled a single request's own sequence of calls. Concurrent requests (multiple users/branches searching enquiries at once) each ran their own 1500ms timer independently, so they could collectively burst past 40/min, and there was no daily-quota awareness at all — the key would silently start returning 429s once 500/day was exhausted, with matches falling back to heuristic/unreachable with only a warn-level log.

**Fix:** a process-wide static gate (`TravelTimeService._orsQueue` chain + `_orsLastCallAt`) now serializes every ORS Matrix call across ALL concurrent requests to enforce the true 40/min pace, plus a daily counter (`_orsDailyCount`, resets at UTC midnight) that proactively halts further calls once within `ORS_MATRIX_DAILY_SAFETY_MARGIN` (20) of the 500/day cap — degrading gracefully to heuristic/unreachable instead of hammering ORS with calls that would 429 anyway. A 429/403 response also flips the halt flag immediately. Status is inspectable via `TravelTimeService.getOrsQuotaStatus()`.

**Why:** multi-week enquiry searches multiply ORS Matrix calls (once per week processed), so quota exhaustion became more likely as that feature grew; the user reported failures and asked specifically for quota safety.

**How to apply:** if enquiry/BD matcher searches start showing many "unreachable" or heuristic-sourced car routes, check `[ORS Quota]` log lines first — a halted state clears automatically at UTC midnight, or immediately if usage genuinely drops. Don't reintroduce a purely local (per-request) rate limit for ORS Matrix; it must stay process-wide to be meaningful. If the app's usage grows further, the real fix is upgrading the ORS plan (contact user before doing this — it's a billing decision) rather than tuning the safety margin further.
