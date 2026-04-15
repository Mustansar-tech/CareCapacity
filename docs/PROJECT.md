# Care Capacity Dashboard — Internal Technical Documentation

> **Audience**: Developers, technical staff, and internal product owners.
> End-user documentation lives at `/docs` in the app (simplified user guide).

---

## Table of Contents

1. [What This Is](#what-this-is)
2. [Tech Stack](#tech-stack)
3. [Architecture Overview](#architecture-overview)
4. [Server Folder Structure](#server-folder-structure)
5. [Key Files](#key-files)
6. [Authentication & RBAC](#authentication--rbac)
7. [Data Pipeline](#data-pipeline)
   - [Required Input Files](#required-input-files)
   - [Processing Stages](#processing-stages)
   - [Name Normalisation](#name-normalisation)
   - [Status Canonicalisation](#status-canonicalisation)
   - [GH Loss Calculation](#gh-loss-calculation)
   - [Free Window Calculation](#free-window-calculation)
   - [Geocoding](#geocoding)
   - [Failure Modes](#failure-modes)
8. [Dashboard KPIs — Derivation](#dashboard-kpis--derivation)
9. [BD Matrix — Algorithm](#bd-matrix--algorithm)
   - [Time Blocks](#time-blocks)
   - [Availability Determination](#availability-determination)
   - [Multi-block Intersection](#multi-block-intersection)
   - [Client Enquiry Matcher](#client-enquiry-matcher)
10. [Scheduling Engine](#scheduling-engine)
    - [Inputs](#inputs)
    - [Algorithm](#algorithm)
    - [Scoring Function](#scoring-function)
    - [Hard Constraints](#hard-constraints)
11. [Travel Time Logic](#travel-time-logic)
12. [People Planner Automation](#people-planner-automation)
13. [Data Formats — Column Name Variants](#data-formats--column-name-variants)
14. [External APIs & Environment Secrets](#external-apis--environment-secrets)
15. [Multi-Branch Model](#multi-branch-model)
16. [Drag-Drop Visit Assignment](#drag-drop-visit-assignment)

---

## What This Is

A scheduling and workforce intelligence platform for Home Instead franchise branches. It ingests Excel exports from the care management system (Access People Planner), geocodes every address, computes real road/transit travel times, and runs a VRPTW-based engine to produce a legally compliant, geographically efficient weekly care schedule.

---

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite, shadcn/ui, TanStack Query v5, Wouter routing, Recharts, React Leaflet, Framer Motion
- **Backend**: Express + TypeScript, Multer, ExcelJS, Zod
- **Database**: PostgreSQL (Neon serverless) + Drizzle ORM
- **APIs**:
  - ORS Matrix (car pre-warm)
  - ORS Directions (car fallback)
  - TravelTime API (walker/public transport, on-demand live routing)
  - Haversine (walker/public prewarm + car last resort)
  - postcodes.io (UK postcode geocoding, including terminated postcode fallback)

---

## Architecture Overview

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

## Server Folder Structure

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
    imports/          excel-parser.ts, pipeline-utils.ts, geocoding.ts
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

---

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
| `server/features/imports/excel-parser.ts` | Raw Excel parsing, row extraction |
| `server/features/imports/pipeline-utils.ts` | Name normalisation, status mapping, GH Loss |
| `server/features/imports/geocoding.ts` | Postcode geocoding with terminated postcode fallback |
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

## Authentication & RBAC

Enterprise auth via express-session + bcrypt. Roles: `admin > manager > supervisor > viewer`.

- **Seeding admin**: Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Replit Secrets, plus `SESSION_SECRET`. On startup the server creates the admin user if it doesn't exist.
- `server/auth.ts`: `requireAuth`, `requireRole`, `auditLog` middleware
- `server/auth-routes.ts`: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`, user CRUD endpoints
- `client/src/contexts/AuthContext.tsx`: global auth state, `useAuth()` hook
- `client/src/pages/login.tsx`: enterprise login page
- `client/src/pages/admin.tsx`: user management + audit log (admin only)
- `shared/schema.ts`: `users`, `userBranches`, `auditLogs` tables

---

## Data Pipeline

`parseExcelFiles` in `server/features/imports/excel-parser.ts` returns two datasets:
- `guaranteed` — filtered for capacity calculations (excludes overnight visits, cancellations, secondary care, live-in care)
- `guaranteedRaw` — unfiltered; used exclusively for GH Loss (`buildGhLossWeeklyRawSummary`) to correctly include overnight visits and paid cancellations

### Required Input Files

| File | Sheet | Purpose |
|---|---|---|
| Availability Export | `CAREGiver Availability` | Daily availability windows and leave/unavailability records |
| Guaranteed Hours Export | `Data` | Scheduled visits, service types, pay hours, cancellation flags |
| CG Data Export | Single sheet | Employee master list: contracted hours, transport mode, gender, home postcode |

**Critical**: CG Data is the authoritative employee roster. Care Pros absent from it are excluded from all capacity calculations.

### Processing Stages

1. **Parsing** — Excel buffers via xlsx-compat. Rows extracted as plain objects keyed by column header. Parser probes multiple column name variants per field (see [Data Formats](#data-formats--column-name-variants)).

2. **Name normalisation** — See [Name Normalisation](#name-normalisation).

3. **Status canonicalisation** — Raw availability strings mapped to a fixed enum. See [Status Canonicalisation](#status-canonicalisation).

4. **Status priority resolution** — When a Care Pro has conflicting records for the same day, highest-priority status wins.  
   Priority order (highest first): `AWOL → Maternity/Paternity → Educational Commitment / Jury Service → Sick → Holiday → Compassionate / Dependant Leave → Other Unavailable → Partial Availability → Available / Ad-hoc`

5. **Scheduled hours computation** — Per visit row in GH export:
   - Skip cancelled visits (Cancellation Description non-blank, excluding "(blank)" and "N/A")
   - Skip Multiple Care (Secondary) visits
   - Skip Live In Care visits
   - Skip overnight visits (start date ≠ end date) — **excluded from capacity but included in `guaranteedRaw`/GH Loss**
   - Include office/training/shadowing/meeting/admin: reads pay hours; if pay = 0 and timestamps exist, calculates duration from timestamps
   - Accumulates into map keyed by `normalisedName|YYYY-MM-DD`

6. **Free window calculation** — See [Free Window Calculation](#free-window-calculation).

7. **Geocoding** — Home postcodes from CG Data and client addresses from GH export. See [Geocoding](#geocoding).

8. **Persistence** — Processed result stored as weekly snapshot keyed by branch and week start date. Re-uploading same week overwrites. Historical snapshots retained.

### Name Normalisation

`normaliseName` in `server/features/imports/pipeline-utils.ts`:

1. Lowercase
2. Strip parenthetical annotations including GH tags — `(24 GH)`, `24 GH`
3. Remove title prefixes: `Mr`, `Mrs`, `Dr`, etc.
4. Remove non-alpha characters
5. Split on whitespace
6. Sort tokens alphabetically
7. Rejoin

Result: `"Smith, Jane (24 GH)"` and `"Jane Smith"` both → `"jane smith"`

**Critical**: `normaliseName` must stay in sync between server (`pipeline-utils.ts`) and client (`dashboard-utils.tsx`). Divergence causes cross-file matching failures.

`resolveTargetKey` uses fuzzy/subset matching: shorter names are matched to longer GH target keys, enabling partial name matching across file formats.

### Status Canonicalisation

Raw status strings mapped via prefix/substring matching (lowercased). Known enum values:

```
Available | Holiday | Sick | Maternity/Paternity | AWOL | Compassionate Leave |
Dependant Leave | Educational Commitment | Jury Service | Other Unavailable |
Pre-Agreed Appointment | Ad-hoc
```

**Day-Killers** (eliminate entire day's contracted hours): Holiday, Sick, Maternity/Paternity, Compassionate Leave, AWOL, Jury Service, Educational Commitment, Dependant Leave

**Time-Killers** (subtract only their specific window): Other Unavailable, Pre-Agreed Appointment

### GH Loss Calculation

GH Loss is calculated only for employees whose name contains a GH annotation in the format `(24 GH)` or `24 GH`. The numeric value is the contracted GH target.

```
Loss = GH_target − Σ(scheduledHours) − Σ(unavailabilityHours)   [per employee, week]
```

- Uses `guaranteedRaw` (unfiltered) so overnight visits and paid cancellations are included
- Employees with `Ad-hoc` status are excluded even if annotated
- Positive loss = unworked contracted hours

### Free Window Calculation

Per employee per day:

1. Parse availability windows into `[startMin, endMin]` intervals
2. Parse Time-Killer unavailability windows and subtract from availability
3. Parse scheduled visit windows (from GH data) and subtract from remaining availability
4. Merge adjacent/overlapping intervals
5. Round start times UP and end times DOWN to nearest 15-minute boundary
6. Discard any window shorter than 60 minutes

Result stored per-employee-per-day; consumed by BD Matrix and Enquiry Matcher.

### Geocoding

`geocodeWithFallback` in `server/features/imports/geocoding.ts`:

- Primary: `postcodes.io` lookup
- Terminated postcode fallback: on 404, extracts `terminated.latitude/longitude` from the response body (known postcodes that have been retired but still have stored coordinates)
- Failed geocodes are logged and retried on next startup sweep (geo-sweeper job)
- Known unresolvable postcodes (wrong/non-existent in People Planner): G63 6HU, G62 3BZ, ML6 5AZ

Glasgow North branch ID: `2f706320-5585-4e3c-8eb2-6c624acd7fca`

### Failure Modes

| Failure | Impact |
|---|---|
| Wrong export type uploaded | Column headers won't match; fields silently resolve as undefined. Hours totals will be zero or missing. |
| Missing CG Data file | Employee roster empty or incomplete. Contracted hours KPIs and utilisation wrong. |
| Partial-week export | Daily totals correct for included days; weekly aggregates understated. No error raised. |
| Column header renamed upstream | Pipeline probes known variants — if new name not in list, field silently skipped. |
| Name formatting change between files | Cross-file matching fails for that employee. |

---

## Dashboard KPIs — Derivation

| KPI | Formula |
|---|---|
| Net Capacity | Contracted daily hours − (Day-Killer hours + Time-Killer hours) |
| Scheduled Hours | Σ Pay Hours across non-cancelled, non-excluded visits |
| Client Required (Demand) | Σ visit durations for client-facing visits only (excludes office/training/admin, secondary, live-in, overnight) |
| Utilisation | Scheduled Hours ÷ Net Capacity × 100 |
| GH Loss | GH target − weeklyScheduled − weeklyUnavailability (per employee, summed) |

**Ad-hoc status**: Care Pro appears in GH rota for a day but has no availability record. Included in scheduled hours; excluded from BD Matrix and free windows.

---

## BD Matrix — Algorithm

### Time Blocks

11 fixed 60-minute blocks aligned to company scheduling standards:

```
08:00–09:00 | 09:15–10:15 | 10:30–11:30 | 11:45–12:45 | 13:00–14:00
14:15–15:15 | 15:30–16:30 | 16:45–17:45 | 18:00–19:00 | 19:15–20:15 | 20:30–21:30
```

### Availability Determination

A Care Pro is counted as available in a block if and only if at least one of their computed free windows fully contains the block:

```
windowStart ≤ blockStart  AND  windowEnd ≥ blockEnd
```

Partial overlap is not counted. Intentional strictness ensures cells represent genuinely assignable slots.

### Multi-block Intersection

When multiple time blocks are selected, the matrix computes a set intersection: Care Pros present in all selected sets. Used to identify staff who can cover a client requiring visits across multiple time windows on the same day.

### Client Enquiry Matcher

Four sequential constraint layers per candidate:

1. **Availability**: Exact containment check. If no exact match, engine searches nearest available block within 150 minutes of requested time.
2. **Daily working time cap**: Hard exclusion if Care Pro already scheduled for ≥ 9 hours that day.
3. **Mandatory rest break**: If Care Pro has accumulated ≥ 5 continuous hours (gaps < 30 min don't reset counter), a 30-minute break is injected before the proposed visit, shifting effective start to next 15-minute boundary.
4. **Travel feasibility**:
   - Inbound: travel time from home (or previous client if gap < 90 min). If travel exceeds gap → rejected.
   - Outbound: if Care Pro cannot reach next scheduled visit on time after completing proposed visit (tolerance: travel exceeds gap by > 20 min) → rejected.

**Scoring** (candidates passing all constraints):
- Window slack: 40%
- Travel distance added to day: 25%
- Home proximity for first/last visit: 25%
- Run tightness: 10%

Gender matching applied as hard filter if client has gender preference encoded in name: `(F)` or `(M)`.

---

## Scheduling Engine

`client/src/utils/scheduling-engine.ts` — runs client-side (browser) to avoid server timeouts.

### Inputs
- Visits: geocoded client coordinates, required time windows, gender requirements
- Employees: home coordinates, transport mode (Car / Walking / Public), gender, computed free windows
- Contract data: weekly contracted hours vs currently assigned minutes

### Algorithm

1. **Pre-processing**: Office/shadowing visits excluded. Client visits geographically clustered.
2. **Walker-first pass**: Walking staff assigned first using strict proximity rules (same postcode sector or < 1.5 km from client).
3. **Greedy assignment loop**: Remaining visits scored against every available employee. Highest-scoring feasible assignment committed before moving to next visit.
4. **Break injection**: After assignment, scanner finds shifts > 5 continuous hours and inserts mandatory 30-minute breaks.

### Scoring Function

| Weight | Factor | Description |
|---|---|---|
| 40% | Window slack | Prefers assignments fitting snugly within a window — avoids large unusable gaps |
| 25% | Travel added | Penalises assignments significantly increasing daily travel time |
| 25% | Home proximity | Prefers placing first/last visit closer to employee's home postcode |
| 10% | Run tightness | Slightly favours smaller inter-visit gaps for dense care runs |

GH employees receive a priority boost to ensure contracted hours are preferentially filled before ad-hoc capacity.

### Hard Constraints

- Visit must fit within employee's free window (10-minute tolerance on start time)
- No overlapping visits — assignments strictly chronological
- Daily care hours cap: 9 hours maximum
- Weekly hours cap: contracted hours + 30-minute overage buffer
- Travel time between consecutive visits must not exceed the gap between them
- Gender matching: hard filter where client name contains `(F)` or `(M)` preference
- Sleep-in and Secondary visits skipped — require separate staffing logic

---

## Travel Time Logic

`server/features/travel/travel-time-service.ts`

### API Hierarchy (Car)
1. ORS Matrix (`POST /api/travel-times/batch`) — batch size 50, pre-warms all employee×client pairs
2. ORS Directions — single-pair fallback
3. Unreachable — marked and sent to unallocated if ORS unavailable

### API Hierarchy (Walker / Public Transport)
1. Haversine estimates (Phase 1 scheduling)
2. TravelTime API (`POST /api/travel-times/refine-walker`) — post-scheduling refinement only for assigned pairs

### Two-Phase Walker
- Pairs deduplicated by `{visitDate}-{from}-{to}-{mode}` — different days get separate TravelTime queries (weekend timetables)
- Results in local date-keyed map, not global session cache — avoids cross-day contamination

### Caps
- Car: 45 min (`MAX_TRAVEL_TIME_MINUTES`)
- Walker/public: 60 min (`MAX_TRAVEL_TIME_MINUTES_WALKER`)
- `TRAVEL_COMPRESSION_ALLOWANCE = 0` (strict — no compression)
- ORS 9999 → unallocated

---

## People Planner Automation

`server/features/people-planner/`

### Files

- **`automation-engine.ts`**: Playwright-controlled Chromium. Logs in to Access Identity, navigates to branch workspace URL, opens People Planner, triggers three report downloads in sequence.
- **`report-configs.ts`**: Per-report-type URL, field config, export template names.
- **`automation-routes.ts`**: Express routes under `/api/pp/`. Runs all 3 reports sequentially, feeds buffers through the existing pipeline, persists to DB.

### Frontend

- **`client/src/components/PeoplePlannerPanel.tsx`**: Sheet-based panel, week date picker, per-report status indicators, progress bar, polling `/api/pp/session/:sessionId` every 2s.
- Dashboard trigger button (purple "Sync from People Planner") appears when no data is loaded.

### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/pp/health` | Check credentials configured |
| POST | `/api/pp/trigger` | Start automation session (returns `sessionId`) |
| GET | `/api/pp/session/:sessionId` | Poll session status + per-job details |
| GET | `/api/pp/jobs/:jobId` | Single job info |
| GET | `/api/pp/download/:jobId` | Download individual file |

### Pipeline Steps

1. Session init — Playwright Chromium → Access Identity login → session state (cookies) saved to disk
2. Branch context — navigate to configured branch workspace URL
3. Application launch — open People Planner from Access launcher; wait for full load
4. Triple report download — in sequence: (1) Guaranteed Hours, (2) CG Data, (3) Availability
5. Data processing — Excel buffers passed to same parsing functions as manual upload
6. Visit persistence — extracted visit records upserted into scheduled visits table

**Sensitivity**: Pipeline is sensitive to UI changes in Access People Planner. Monitor session log after each run, especially following Access platform updates.

---

## Data Formats — Column Name Variants

The pipeline probes a prioritised list of column name variants per field.

### Guaranteed Hours Export

| Field | Column name(s) | Notes |
|---|---|---|
| Employee name | Actual Employee Name, Planned Employee Name, Employee Name, Caregiver Name, Care giver Name | Normalised before any lookup |
| Start time | Actual Start Date And Time, Start Date And Time, Planned Start Date And Time | Actual preferred |
| End time | Actual End Date And Time, End Date And Time, Planned End Date And Time | Used to detect overnight visits |
| Service type | Actual Service Type Description, Service Type Description | Used to exclude Secondary, Live In, identify Office/Training |
| Pay hours | Actual Pay Rate Hours, Pay Hours, Pay Rate Hours, Hours | If 0 for office types, duration calculated from timestamps |
| Client name | Service Location Name, Client Name, Service User Name | Demand calculation and map labels |
| Cancellation | Cancellation Description | Blank/(blank)/N/A = included. Any other value = excluded |

### CG Data Export

| Field | Column name | Notes |
|---|---|---|
| Employee name | CAREGiver Name | Primary identifier — must match GH export after normalisation |
| Contracted hours | Weekly Hours | GH Loss and net capacity calculations |
| Transport mode | TransportModeDescription | Car / Walking / Public |
| Gender | Title / Gender | Gender-preference matching in Enquiry Matcher |
| Home postcode | PostCode | Geocoded for map and travel-time calculations |

### Availability Export

| Field | Notes |
|---|---|
| Employee name | Normalised against GH and CG Data |
| Date | Accepts: dd/MM/yyyy, yyyy-MM-dd, dd-MM-yyyy, Excel serial numbers |
| Status | Raw string — canonicalised via substring matching against 12 known statuses |
| Start / End time | Defines availability window or Time-Killer window depending on status |

---

## External APIs & Environment Secrets

| Secret | Purpose |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `SESSION_SECRET` | Express session signing key (any random string ≥32 chars) |
| `ADMIN_EMAIL` | Email for the seeded admin user |
| `ADMIN_PASSWORD` | Password for the seeded admin user (min 8 chars) |
| `ORS_API_KEY` | OpenRouteService API key |
| `TRAVELTIME_APP_ID` | TravelTime application ID |
| `TRAVELTIME_API_KEY` | TravelTime API key |
| `ACCESS_EMAIL` | Email for People Planner / Access Workspace login |
| `ACCESS_PASSWORD` | Password for People Planner / Access Workspace login |
| `PEOPLE_PLANNER_BRANCH_CONFIG` | JSON map of branchId → `{workspaceBranch, plannerArea}` |

---

## Multi-Branch Model

Every DB query is scoped to `branchId`. `BranchContext` provides the active branch globally. No cross-branch data access is possible — switching branches in the UI reloads all data for the new branch.

Known branch IDs:
- Glasgow North: `2f706320-5585-4e3c-8eb2-6c624acd7fca`

---

## Drag-Drop Visit Assignment

Implemented with `@dnd-kit/core` in `weekly-plan-tab.tsx`:

- Each unallocated visit card is draggable (grip handle icon, opacity ghost while dragging)
- On drag start: validates all employees for the visit's day (time windows, daily capacity, travel caps)
- Fixed drop-zone panel at bottom shows employees with green (valid) or red (invalid) highlighting
- On valid drop: inserts visit chronologically, removes from unallocated, auto-saves, shows toast
- On invalid drop: toast with specific rejection reason
- Engine: `client/src/utils/drag-drop-engine.ts` — `validateVisitDrop()`, `buildAssignedVisit()`, `findInsertionIndex()`
