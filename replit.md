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

## Authentication & RBAC

Enterprise auth via express-session + bcrypt. Roles: `admin > manager > supervisor > viewer`.

- **Seeding admin**: Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Replit Secrets, plus `SESSION_SECRET`. On startup, the server creates the admin user if it doesn't exist.
- `server/auth.ts`: `requireAuth`, `requireRole`, `auditLog` middleware
- `server/auth-routes.ts`: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, user CRUD endpoints
- `client/src/contexts/AuthContext.tsx`: global auth state, `useAuth()` hook
- `client/src/pages/login.tsx`: enterprise login page
- `client/src/pages/admin.tsx`: user management + audit log (admin only)
- `shared/schema.ts`: `users`, `userBranches`, `auditLogs` tables added

---

## Drag-Drop Unallocated Visit Assignment

Implemented with @dnd-kit/core in `weekly-plan-tab.tsx`:

- Each unallocated visit card is draggable (grip handle icon, opacity ghost while dragging)
- On drag start: validates all employees for the visit's day (time windows, daily capacity, travel caps)
- A fixed drop-zone panel at the bottom shows employees with green (valid) or red (invalid) highlighting
- On valid drop: inserts visit chronologically, removes from unallocated, auto-saves, shows toast
- On invalid drop: toast with specific rejection reason
- Engine: `client/src/utils/drag-drop-engine.ts` — `validateVisitDrop()`, `buildAssignedVisit()`, `findInsertionIndex()`

---

## Server Folder Structure (feature-based)

```
server/
  infrastructure/     logger, db, security, rate-limiter
  config/             config validation (index.ts)
  shared/             shared-utils, time-window-utils, xlsx-compat, validation
  jobs/               auto-scheduler, geo-sweeper
  features/
    auth/             auth.ts (middleware, RBAC), auth.routes.ts (endpoints)
    bd-matrix/        bdMatcher.ts, bd-matrix-utils.ts
    capacity/         capacity-windows.ts, employee-fit.ts, service-delivery-rules.ts
    cancelled-visits/ cancelled-visits.ts, cancelled-visits-from-gh.ts
    imports/          excel-visit-extractor.ts
    travel/           travel-time-service.ts
    people-planner/   automation-engine.ts, automation-routes.ts, report-configs.ts
  controllers/        thin route handlers
  middleware/         error-handler, require-auth, require-role
  repositories/       DB query functions per entity
  routes/             Express route registration
  services/           business logic (bd-matcher.service.ts)
  utils/              helpers.ts
  storage.ts          IStorage interface + DbStorage (stays at root)
  pipeline.ts         Excel parsing + capacity calculation (stays at root)
  app.ts              Express app setup
  index.ts            Entry point
```

All callers (controllers, middleware, repositories, routes, services, and root files) have been updated to use canonical paths. No shims remain.

## Key Files

| File | Role |
|---|---|
| `shared/schema.ts` | All DB tables, Zod schemas, shared TypeScript types |
| `server/routes.ts` | All API endpoints |
| `server/features/auth/auth.ts` | Auth middleware + admin seed |
| `server/features/auth/auth.routes.ts` | Auth + user management API |
| `server/storage.ts` | IStorage interface + DbStorage + MemStorage |
| `server/features/travel/travel-time-service.ts` | Multi-API travel time logic |
| `server/pipeline.ts` | Excel parsing, capacity calculation |
| `server/features/bd-matrix/bdMatcher.ts` | BD enquiry matching |
| `client/src/utils/scheduling-engine.ts` | VRPTW engine |
| `client/src/utils/scheduling-utils.ts` | Travel cache, helpers, constants |
| `client/src/utils/drag-drop-engine.ts` | Drop validation, visit insertion helpers |
| `client/src/components/weekly-plan-tab.tsx` | Schedule UI + drag-drop + walker refinement |
| `client/src/contexts/AuthContext.tsx` | Global auth state |
| `client/src/pages/dashboard.tsx` | Main multi-tab dashboard |
| `client/src/pages/admin.tsx` | Admin user management panel |
| `client/src/pages/bd-matrix.tsx` | Business development heatmap + enquiry tool |

---

## External Dependencies

- PostgreSQL (Neon serverless)
- OpenRouteService API (ORS_API_KEY env var)
- TravelTime API (TRAVELTIME_APP_ID + TRAVELTIME_API_KEY env vars)
- Geocoding API (for postcode → lat/lng resolution)

## Required Environment Secrets

| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `SESSION_SECRET` | Express session signing key (any random string ≥32 chars) |
| `ADMIN_EMAIL` | Email for the seeded admin user |
| `ADMIN_PASSWORD` | Password for the seeded admin user (min 8 chars) |
| `ORS_API_KEY` | OpenRouteService API key |
| `TRAVELTIME_APP_ID` | TravelTime application ID |
| `TRAVELTIME_API_KEY` | TravelTime API key |
| `ACCESS_EMAIL` | Email for People Planner account slot 1 (required) |
| `ACCESS_PASSWORD` | Password for People Planner account slot 1 (required) |
| `ACCESS_EMAIL_3` | Email for account slot 2 (optional) — numbering jumps from base to `_3`; there is no `_2` pair |
| `ACCESS_PASSWORD_3` | Password for account slot 2 |
| `ACCESS_EMAIL_4` | Email for account slot 3 (optional) |
| `ACCESS_PASSWORD_4` | Password for account slot 3 |
| `ACCESS_EMAIL_5` | Email for account slot 4 (optional) |
| `ACCESS_PASSWORD_5` | Password for account slot 4 |
| `ACCESS_EMAIL_6` | Email for account slot 5 (optional) |
| `ACCESS_PASSWORD_6` | Password for account slot 5 |
| `PEOPLE_PLANNER_BRANCH_CONFIG` | JSON map of branchId → `{workspaceBranch, plannerArea}` |

## People Planner Automation

`server/people-planner/` contains three files:

- **`automation-engine.ts`** — Playwright browser automation: login to Access Workspace, select branch, open People Planner, navigate to export page, configure form, trigger download.
- **`report-configs.ts`** — Per-report-type URL, field config, and export template names.
- **`automation-routes.ts`** — Express routes under `/api/pp/`. Runs all 3 reports sequentially and feeds results through the existing pipeline, then persists to DB.

Frontend:
- **`client/src/components/PeoplePlannerPanel.tsx`** — Sheet-based panel, week date picker, per-report status indicators, progress bar, polling via `/api/pp/session/:sessionId` every 2s.
- Dashboard trigger button (purple "Sync from People Planner") appears when no data is loaded.

API endpoints:
- `GET /api/pp/health` — check credentials configured
- `POST /api/pp/trigger` — start automation session (returns `sessionId`)
- `GET /api/pp/session/:sessionId` — poll session status + per-job details
- `GET /api/pp/jobs/:jobId` — single job info
- `GET /api/pp/download/:jobId` — download individual file
