---
name: Car travel routing provider order
description: Which live routing API is tried first for car travel-time/distance lookups in the BD/enquiry matcher, and why.
---

Mapbox Matrix/Directions API is the **primary** provider for car travel-time and
distance lookups (single-pair and matrix batch). ORS Matrix/Directions is the
**backup**, tried only when Mapbox has no API key configured or a Mapbox call
fails/returns nothing.

**Why:** Mapbox's free tier gives ~100,000 matrix elements/month vs ORS's
effective ~15,000/month, with no approval gating — verified against current
published limits, not assumed from training data. The user explicitly chose
Mapbox as primary and ORS as backup rather than the other way around.

**How to apply:**
- No persistent DB caching was reintroduced for this swap — only an in-memory,
  per-process session cache exists (see the enquiry-matcher-travel-cache-reverted
  memory). Do not add cross-run/DB caching without explicit sign-off.
- Mapbox's Matrix API caps a single request at 25 combined coordinates
  (sources + destinations), much tighter than ORS's 50-per-side batching. The
  service chunks Mapbox matrix calls at 12+12 internally; any future change to
  batch sizing must respect this 25-coordinate ceiling or Mapbox requests will
  fail outright.
- `hasCarMatrixKey()` / `carMatrixBatch()` are the entry points call sites
  should use (not `hasORSKey()`/an ORS-specific method name) so the
  primary/backup logic stays centralized in `travel-time-service.ts`.
