---
name: Car routing provider split
description: Feature-specific routing priorities and the different units used in provider usage quotas.
---

Scheduling uses **ORS first, Mapbox as backup**. Enquiries/BD matching keep
**Mapbox first, ORS as backup**. This applies to both matrices and single-pair
road lookups.

**Why:** The user observed high Mapbox matrix usage from repeated scheduling
runs and explicitly approved ORS-first scheduling with Mapbox fallback, while
retaining Mapbox-first enquiries. Fallback is authorized; this is not a promise
of zero Mapbox usage from scheduling.

**How to apply:**
- No persistent DB caching was reintroduced for this swap — only an in-memory,
  per-process session cache exists (see the enquiry-matcher-travel-cache-reverted
  memory). Do not add cross-run/DB caching without explicit sign-off.
- Do not change the shared enquiry provider default to implement a scheduling
  change. Scheduling must retain its own routing preference, including
  cold-cache single-pair lookups.
- Preserve bounded scheduling requests and opt-in road-provider deadlines when
  changing provider priorities; see scheduling-travel-prefetch-timeouts.md.
- Valid ORS matrices with null routes indicate unreachable journeys, not an
  outage requiring paid fallback. Failed, timed-out or malformed responses
  should use the approved backup.

Compare provider quotas using their actual units.

**Why:** ORS Standard matrix quotas count requests, while the Mapbox usage shown
by the user counts matrix elements (source × destination combinations). An old
comparison of ORS monthly requests with Mapbox monthly elements was misleading.

**How to apply:** Verify current limits against
https://openrouteservice.org/plans/ and https://openrouteservice.org/restrictions/
before estimating run capacity. Count route combinations separately from
provider requests; account for fallback when explaining Mapbox usage.
