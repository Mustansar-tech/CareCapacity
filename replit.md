# Care Capacity Dashboard

## Quick Reference

Full documentation lives in two files:
- **PROJECT.md** — architecture, schema, algorithms, API endpoints, constants
- **GUIDE.md** — how to use every feature as an end user

---

## What This App Is

A scheduling and route optimisation platform for Home Instead franchise branches. It ingests Excel exports from the care management system, geocodes every address, computes real road/transit travel times, and runs a VRPTW-based engine to produce a legally compliant, geographically efficient weekly care schedule.

---

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite, shadcn/ui, TanStack Query v5, Wouter routing, Recharts, React Leaflet, Framer Motion
- **Backend**: Express + TypeScript, Multer, ExcelJS, Zod
- **Database**: PostgreSQL (Neon serverless) + Drizzle ORM
- **APIs**: ORS Matrix (car pre-warm), ORS Directions (car fallback), OSRM (free car fallback), TravelTime API (walker/public transport, on-demand live routing), Haversine (walker/public prewarm + car last resort)

---

## Architecture Decisions

### Multi-Branch
Every DB query is scoped to `branchId`. `BranchContext` provides the active branch globally. There is no cross-branch data access.

### Scheduling Engine Runs Client-Side
The VRPTW engine (`client/src/utils/scheduling-engine.ts`) runs in the browser to avoid server timeouts with large datasets. The server handles API orchestration and DB persistence.

### Two-Phase Walker Scheduling
1. **Phase 1**: Schedule with Haversine estimates (instant, no API calls).
2. **Phase 2 (post-schedule)**: Call `POST /api/travel-times/refine-walker` with only the assigned walker/public pairs. Pairs are deduplicated by `{visitDate}-{from}-{to}-{mode}` so different days get separate TravelTime queries (weekends use weekend timetables). Results stored in a local date-keyed map — not the global session cache — to avoid cross-day contamination.

### ORS Matrix for Car Routes
Called via `POST /api/travel-times/batch` before scheduling. Batch size 50. Returns results for all employee×client pairs. DB-level travel cache is disabled — session cache only.

### Travel Caps
- Car: 45 minutes (`MAX_TRAVEL_TIME_MINUTES`)
- Walker / public: 60 minutes (`MAX_TRAVEL_TIME_MINUTES_WALKER`)
- Unreachable (ORS returns 9999) → visit goes to unallocated

### TRAVEL_COMPRESSION_ALLOWANCE = 0
Strict gap checking — no time compression. Visit time windows are fixed.

---

## User Preferences

- Plain language, no technical jargon in the UI
- Care home scheduling teams and business development staff are the audience
- Dark mode supported via class-based toggling

---

## Key Files

| File | Role |
|---|---|
| `shared/schema.ts` | All DB tables, Zod schemas, shared TypeScript types |
| `server/routes.ts` | All API endpoints |
| `server/travel-time-service.ts` | Multi-API travel time logic |
| `server/pipeline.ts` | Excel parsing, capacity calculation |
| `server/bdMatcher.ts` | BD enquiry matching |
| `client/src/utils/scheduling-engine.ts` | VRPTW engine |
| `client/src/utils/scheduling-utils.ts` | Travel cache, helpers, constants |
| `client/src/components/weekly-plan-tab.tsx` | Schedule UI + walker refinement flow |
| `client/src/pages/dashboard.tsx` | Main multi-tab dashboard |
| `client/src/pages/bd-matrix.tsx` | Business development heatmap + enquiry tool |

---

## External Dependencies

- PostgreSQL (Neon serverless)
- OpenRouteService API (ORS_API_KEY env var)
- TravelTime API (TRAVELTIME_APP_ID + TRAVELTIME_API_KEY env vars)
- Geocoding API (for postcode → lat/lng resolution)
