# Care Capacity Dashboard — Full Project Reference

## What This Application Does

The Care Capacity Dashboard is a scheduling and route optimisation platform built for Home Instead franchise branches. It solves the hardest part of home care operations: taking thousands of individual care visits, dozens of care professionals with different contracts, transport modes, locations, and gender requirements, and producing a legally compliant, geographically efficient weekly schedule — automatically.

The platform ingests raw Excel exports from the care management system, geocodes every home address, computes real road and public transport travel times, and runs a constraint-based optimisation engine that assigns visits to care professionals. It also provides business development tools, historical capacity analytics, and a full export capability.

---

## Technology Stack

**Frontend**
- React 18 + TypeScript, built and served by Vite
- Routing via `wouter` (single-page app, one route: `/`)
- UI components from shadcn/ui (Radix primitives + Tailwind CSS)
- Data fetching and caching via TanStack Query v5
- Charts via Recharts
- Map display via React Leaflet
- Animation via Framer Motion
- Dark mode via `next-themes` with class-based toggling

**Backend**
- Node.js + Express + TypeScript
- Multer for multipart file uploads
- ExcelJS (via `xlsx-compat.ts`) for reading and writing Excel files
- Zod for request validation

**Database**
- PostgreSQL (Neon serverless)
- Drizzle ORM for type-safe queries
- `drizzle-zod` for auto-generated insert schemas

**External APIs**
- OpenRouteService (ORS) Matrix — batch car route pre-warm
- ORS Directions — individual car route fallback
- OSRM (OpenStreetMap) — free driving routes when ORS is unavailable
- TravelTime API — walking and public transport routing (arrival_searches)
- Google Maps-compatible geocoding — postcode → lat/lng

---

## Repository Structure

```
├── client/src/
│   ├── App.tsx                     # Root, providers, navigation, error boundary
│   ├── pages/
│   │   ├── dashboard.tsx           # Main multi-tab dashboard
│   │   ├── bd-matrix.tsx           # Business development heatmap + enquiry tool
│   │   └── data-management.tsx     # Excel file upload interface
│   ├── components/
│   │   ├── weekly-plan-tab.tsx     # Schedule generation + walker refinement UI
│   │   ├── scheduling-tab.tsx      # Schedule viewer
│   │   ├── BranchSelector.tsx      # Multi-franchise context switcher
│   │   ├── SplashScreen.tsx        # Animated intro
│   │   └── ui/                     # shadcn/ui component library
│   ├── utils/
│   │   ├── scheduling-engine.ts    # VRPTW optimisation engine (client-side)
│   │   ├── scheduling-utils.ts     # Travel time helpers, cache, constants
│   │   └── scheduling-scoring.ts   # Employee scoring functions
│   ├── contexts/
│   │   └── BranchContext.tsx       # Global branch selection
│   └── lib/
│       └── queryClient.ts          # TanStack Query setup + apiRequest helper
├── server/
│   ├── index.ts                    # Express app entry point, middleware
│   ├── routes.ts                   # All API endpoint definitions
│   ├── storage.ts                  # Drizzle ORM data access layer
│   ├── travel-time-service.ts      # Multi-API travel time logic
│   ├── auto-scheduler.ts           # Server-side scheduling orchestration
│   ├── pipeline.ts                 # Excel parsing and data processing
│   ├── excel-visit-extractor.ts    # Pull visits from Guaranteed Hours workbook
│   ├── bdMatcher.ts                # BD enquiry matching logic
│   ├── geocoding-service.ts        # Postcode → coordinates
│   ├── security.ts                 # Security headers, rate limiting
│   ├── logger.ts                   # Structured logging (suppresses debug in prod)
│   └── db.ts                       # Drizzle + Neon connection
├── shared/
│   └── schema.ts                   # Drizzle table definitions, Zod schemas, shared types
└── drizzle.config.ts               # Database migration config
```

---

## Database Schema

### `branches`
Multi-franchise support. Every data row in the system is scoped to a branch via `branchId`. There is no cross-branch data leakage.

| Column | Type | Notes |
|---|---|---|
| id | varchar (UUID) | Primary key |
| name | text | Unique slug (e.g. `home-instead-glasgow`) |
| displayName | text | Human label shown in UI |

### `capacity_analyses`
Stores the processed result of an Excel upload for a specific week. The `kpis`, `dailySummary`, `employeesByDate`, and `employeeSummaryByDate` columns are JSON blobs holding all computed values.

Unique constraint: one record per `(branchId, weekStartDate, weekEndDate)` — uploading a week twice overwrites the previous result.

### `branch_uploads`
Stores the raw (base64-encoded) Excel file buffers — one per upload type per branch. Types: `guaranteedHours`, `availability`, `demand`, `cgData`. Used to replay the visit extraction without re-uploading.

### `employee_locations`
| Column | Type | Notes |
|---|---|---|
| employeeName | text | Matched against care management data |
| homePostcode | text | Used for geocoding |
| homeLat, homeLng | text | Resolved coordinates |
| transportMode | enum | `car` \| `walking` \| `public` |
| gender | enum | `male` \| `female` — used for gender-matched care |

Unique per `(branchId, employeeName)`. Geocoding happens on first save and is cached.

### `client_locations`
| Column | Type | Notes |
|---|---|---|
| clientName | text | Matched against visit data |
| addressLine | text | Full street address |
| postcode | text | For geocoding |
| lat, lng | text | Resolved coordinates |

### `visits`
Individual care sessions: duration, preferred time window, priority, service type. Linked to `clientLocations` and scoped to a branch and date.

### `route_plans` + `route_stops`
Output of the optimisation engine — stores the full assigned schedule with per-stop travel times and distances.

### `weekly_schedules`
High-level JSON blob of a generated weekly schedule: employee→day→visits assignments, unallocated visits list, and summary metrics. One record per `(branchId, weekStartDate, weekEndDate)`.

### `travel_time_cache`
Persists resolved travel durations from all API sources. Sources tracked: `ors`, `ors-matrix`, `osrm`, `traveltime`, `traveltime-matrix`, `heuristic`. Keyed by `(branchId, fromLat, fromLng, toLat, toLng, transportMode)`.

Note: DB-level cache is currently disabled — only the in-memory session cache is used per scheduling run. The table exists for potential future reactivation.

### `geocode_cache`
Postcode → lat/lng resolution results. Keyed by `(branchId, key)` where key is the normalised postcode or address string.

### `branch_scheduling_preferences`
Per-branch configuration: which service types to exclude from scheduling (e.g. `sleep in`, `office hours`, `secondary`). Adjustable without code changes.

### `client_enquiries`
Saved BD matching enquiries — stores both the input criteria (required days, time windows, gender, number of care pros) and the matching results. Supports multi-visit enquiries with per-visit results tabs.

---

## Excel File Inputs

The system requires three (optionally four) Excel exports from the care management platform:

| File | Purpose |
|---|---|
| **Availability Export** | Care pro availability, time windows, leave, sickness |
| **Care Pro Guaranteed Hours** | Contracted hours per week, all scheduled visits with timestamps |
| **CG Data Export** | Home postcodes, transport modes, gender |
| **Hours by Service Type** *(optional)* | Client demand data for capacity gap analysis |

### Column Handling
- Column names are matched flexibly — common variations in spacing, capitalisation, and formatting are handled automatically.
- Employee names go through a three-level fallback: Actual Name → Planned Name → Service Requirement.
- Night/sleep-in/overnight visits are excluded from capacity totals.
- Rows with any value in Cancellation Description are excluded from scheduled hours.

---

## Data Processing Pipeline (`server/pipeline.ts`)

1. **Parse** — Read all uploaded Excel buffers from `branch_uploads` into row arrays.
2. **Geocode** — Extract postcodes from CG Data, hit geocoding API, persist to `geocode_cache`.
3. **Capacity computation** — Per employee per day:
   - Gross capacity = contracted daily hours
   - Deductions = unavailability + sickness + holidays (capped at contracted hours)
   - Net capacity = gross − deductions
4. **Scheduled hours** — Sum actual visit durations from Guaranteed Hours export.
5. **KPI rollup** — Week-level sums across all employees and days.
6. **Persist** — Write `capacity_analyses` record; upsert `employee_locations` and `client_locations`.

---

## Scheduling Engine

The scheduling engine runs entirely on the client (browser) inside `client/src/utils/scheduling-engine.ts`. This avoids server timeouts for large datasets and keeps the UI responsive during generation.

### Algorithm: Multi-Pass VRPTW

The engine implements a Vehicle Routing Problem with Time Windows (VRPTW), adapted for home care constraints:

**Pass 1 — Core assignment (all employees, scored)**
Iterates visits in time-window order. For each visit, scores every eligible employee and picks the best candidate. Scoring factors:
- Travel time from previous location (lower = better)
- Care continuity: 15% bonus if same employee served this client on a previous day, 10% for fuzzy name match
- Geographic clustering: favour employees already working nearby
- Shift compactness: 10% bonus for tight back-to-back schedules

**Pass 2 — Gap fill (relaxed time windows)**
Second attempt for unallocated visits with ±15 minute window relaxation.

**Pass 3 — Desperation pass**
Further relaxation including partial gender requirement relaxation, ensuring maximum allocation even in constrained scenarios.

### Hard Constraints (never violated)
- **Time windows**: Visit start/end times must fit within employee's available window for the day
- **Travel cap**: Car employees — 45 minutes max travel between any two locations. Walker/public — 60 minutes max.
- **Unreachable routes**: If ORS Matrix returns 9999 (no route), the visit is sent to unallocated.
- **Gender matching**: If a client requires a female care pro, only female employees are eligible (relaxed in pass 3 only)
- **Capacity**: Cannot exceed employee's contracted daily hours
- **Statutory rest**: 20-minute break injected automatically after 6 hours of consecutive work

### Travel Time in the Engine
The engine's `getTravelMinutes` function reads from an in-memory session cache populated before scheduling runs:
- **Car**: Cache seeded by ORS Matrix batch pre-warm via `POST /api/travel-times/batch`
- **Walker/public**: Cache initially populated with Haversine estimates; replaced after scheduling by TravelTime API results via `POST /api/travel-times/refine-walker`

### Two-Phase Walker Scheduling

**Phase 1 (Pre-schedule):** Walker/public visits are scheduled using fast Haversine straight-line estimates. No API calls. Schedule generates instantly.

**Phase 2 (Post-schedule refinement):**
1. Collect every unique route pair assigned to walker/public employees (home→first visit, visit→visit, last visit→home).
2. Deduplicate by `{visitDate}-{fromLat},{fromLng}-{toLat},{toLng}-{mode}` — crucially, pairs on different days are kept separate so Saturday uses Saturday's bus timetable, not Monday's.
3. Call `POST /api/travel-times/refine-walker` with the pair list.
4. Server calls TravelTime API sequentially (400ms delay between calls) using `arrival_searches` — "arrive at client's address by visit start time" — with the actual visit date so TravelTime queries the correct day-of-week schedule.
5. Results are stored in a date-keyed local map and used to recompute `travelTimeBefore` for every walker visit.
6. Visits where refined travel time exceeds 60 minutes are flagged with an amber warning badge.

---

## Travel Time Service (`server/travel-time-service.ts`)

### Car Employees

**Primary: ORS Matrix API (batch)**
Called before scheduling via `POST /api/travel-times/batch`. Processes all employee×client combinations in batches of up to 50×50 using ORS Matrix, which converts thousands of individual lookups into a few batch requests.

**Fallback 1: ORS Directions API**
Individual point-to-point call when Matrix result is missing.

**Fallback 2: OSRM**
Free OpenStreetMap routing. No API key required. Used when ORS is rate-limited or unavailable.

**Fallback 3: Haversine heuristic**
Straight-line distance with a 1.3× road factor and congestion multiplier based on time of day. Last resort only.

If any source returns 9999 (unreachable), the route is treated as infeasible and the visit goes to unallocated.

### Walker / Public Transport Employees

**Primary: TravelTime API (`/v4/time-filter`)**
Uses `arrival_searches` — the API answers "what is the latest departure time to arrive at {destination} by {arrival_time}?" and returns journey duration. This correctly accounts for:
- Time of day (rush hour vs mid-day vs evening bus frequency)
- Day of week (weekday vs weekend — fewer services on Saturdays/Sundays)
- Mode selection: ≤1.6km straight-line → `walking`; >1.6km → `public_transport`

Both the arrival time and the calendar date are passed so the query reflects the actual visit slot.

**Fallback: Haversine heuristic**
Applied only if TravelTime API credentials are absent or the call fails.

### Session Cache
Each scheduling run starts with a reset session cache (`_sessionCache`). All API results are written to this cache during the run. The cache is keyed by `fromLat-fromLng-toLat-toLng-mode`. DB-level cache persistence is disabled — every run fetches fresh data.

### Source Tracking
The `travelSources` state in the UI aggregates counts from both the ORS pre-warm (car routes) and the TravelTime refinement (walker routes), displaying an accurate breakdown of all data sources used: ORS Matrix, TravelTime API, Heuristic, etc.

---

## API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/branches` | List all branches |
| POST | `/api/process` | Upload Excel files + process |
| GET | `/api/history` | List past capacity analyses |
| GET | `/api/history/latest` | Most recent analysis for branch |
| GET | `/api/locations` | Employee + client locations for current branch |
| POST | `/api/geo/geocode-batch` | Geocode a batch of postcodes |
| POST | `/api/travel-times/batch` | ORS Matrix pre-warm for car routes |
| POST | `/api/travel-times/refine-walker` | TravelTime refinement for walker/public routes |
| POST | `/api/weekly-schedule/generate` | (Legacy) server-side schedule generation |
| POST | `/api/weekly-schedule/save` | Persist generated schedule to DB |
| GET | `/api/weekly-schedule/latest` | Latest schedule for branch+week |
| GET | `/api/weekly-schedule/:weekStartDate` | Schedule for specific week |
| POST | `/api/bd-matcher` | Single-visit BD matching |
| POST | `/api/bd-matcher/multi-visit` | Multi-visit BD matching (up to 5 visits) |
| POST | `/api/client-enquiries` | Save BD enquiry + results |
| GET | `/api/client-enquiries` | List saved enquiries |
| DELETE | `/api/client-enquiries/:id` | Remove saved enquiry |
| GET | `/api/export` | Download Excel export |
| POST | `/api/cleanup` | Delete analyses older than N months |

---

## Business Development (BD) Matrix

The BD Matrix tab shows a 7-day heatmap of care pro availability. Each cell represents one employee's free capacity on one day.

### Client Enquiry Matching
Staff enter a prospective client's requirements:
- Required days of the week
- Preferred arrival time window
- Visit duration in minutes
- Number of care pros needed (1–3 per visit)
- Gender preference per care pro
- Up to 5 separate visit slots per client

The matcher (`server/bdMatcher.ts`) scores every eligible employee against:
- Availability on required days and within time windows
- Gender match
- Proximity to client postcode (via geocoded distance)
- Care continuity with existing similar clients

Results are displayed per visit slot with ranked matches, saved to `client_enquiries` for history.

---

## Multi-Branch (Franchise) Support

Every database query is scoped to the active `branchId`. The `BranchContext` provides the currently selected branch to all components. The `BranchSelector` dropdown in the navigation bar switches context without a page reload. Branches are created via the data management interface and persist in PostgreSQL.

---

## Security and Production Behaviour

- **Structured logging**: `server/logger.ts` suppresses debug/info logs in production; outputs JSON; strips stack traces from error responses.
- **Safe error messages**: `safeErrorMessage()` helper prevents internal paths, variable names, and traces from appearing in API error responses.
- **Security headers**: CSP, HSTS, X-Content-Type-Options, XSS protection applied by `server/security.ts`.
- **Rate limiting**: Applied to all `/api` routes in production.
- **No DB cache**: Travel time DB cache is disabled — always fetches fresh from APIs to ensure accuracy.

---

## Key Constants

| Constant | Value | Location | Purpose |
|---|---|---|---|
| `MAX_TRAVEL_TIME_MINUTES` | 45 | `scheduling-utils.ts` | Car employee travel cap |
| `MAX_TRAVEL_TIME_MINUTES_WALKER` | 60 | `scheduling-utils.ts` | Walker/public travel cap |
| `TRAVEL_COMPRESSION_ALLOWANCE` | 0 | `scheduling-engine.ts` | No time compression — strict gaps |
| `WALK_THRESHOLD_KM` | 1.6 | `travel-time-service.ts` | Walking vs public transport switch |
| ORS batch size | 50 | `travel-time-service.ts` | Max locations per ORS Matrix call |
| Walker refinement delay | 400ms | `routes.ts` | Between-call delay for TravelTime rate limits |
