# Care Capacity Dashboard — Internal Technical Documentation

> **Audience**: Developers, technical staff, and internal product owners.
> End-user documentation lives in `/docs` within the app.

---

## Table of Contents

1. [What This Is](#what-this-is)
2. [Tech Stack](#tech-stack)
3. [Architecture Overview](#architecture-overview)
4. [Server Folder Structure](#server-folder-structure)
5. [Key Files](#key-files)
6. [Database Schema](#database-schema)
7. [Authentication & RBAC](#authentication--rbac)
8. [API Endpoints](#api-endpoints)
9. [Frontend Pages & Tabs](#frontend-pages--tabs)
10. [Data Pipeline](#data-pipeline)
    - [Required Input Files](#required-input-files)
    - [Processing Stages](#processing-stages)
    - [Name Normalisation](#name-normalisation)
    - [Status Canonicalisation](#status-canonicalisation)
    - [GH Loss Calculation](#gh-loss-calculation)
    - [Free Window Calculation](#free-window-calculation)
    - [Geocoding](#geocoding)
    - [Failure Modes](#failure-modes)
11. [Dashboard KPIs — Derivation](#dashboard-kpis--derivation)
12. [BD Matrix — Algorithm](#bd-matrix--algorithm)
    - [Time Blocks](#time-blocks)
    - [Availability Determination](#availability-determination)
    - [Multi-block Intersection](#multi-block-intersection)
    - [Client Enquiry Matcher](#client-enquiry-matcher)
13. [Scheduling Engine](#scheduling-engine)
    - [Inputs](#inputs)
    - [Algorithm](#algorithm)
    - [Scoring Function](#scoring-function)
    - [Hard Constraints](#hard-constraints)
    - [Drag-Drop Visit Assignment](#drag-drop-visit-assignment)
14. [Travel Time Logic](#travel-time-logic)
15. [Capacity Outlook](#capacity-outlook)
    - [Joiner Pipeline](#joiner-pipeline)
    - [Monthly Snapshots](#monthly-snapshots)
    - [Cumulative KPIs](#cumulative-kpis)
16. [Workforce / HR Calendar](#workforce--hr-calendar)
17. [Leaver Email Report](#leaver-email-report)
18. [People Planner Automation](#people-planner-automation)
19. [Key Constants](#key-constants)
20. [Data Formats — Column Name Variants](#data-formats--column-name-variants)
21. [External APIs & Environment Secrets](#external-apis--environment-secrets)
22. [Multi-Branch Model](#multi-branch-model)

---

## What This Is

A scheduling and workforce intelligence platform for Home Instead franchise branches. It ingests Excel exports from the care management system (Access People Planner), geocodes every address, computes real road/transit travel times, and runs a VRPTW-based engine to produce a legally compliant, geographically efficient weekly care schedule.

---

## Tech Stack

- **Frontend**: React 18 + TypeScript, Vite, shadcn/ui, TanStack Query v5, Wouter routing, Recharts, React Leaflet, Framer Motion
- **Backend**: Express + TypeScript, Multer, ExcelJS, Zod
- **Database**: PostgreSQL (Neon serverless) + Drizzle ORM
- **Email**: Resend API
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
  infrastructure/       logger, db, security, rate-limiter
  config/               config validation (index.ts)
  shared/               shared-utils, time-window-utils, xlsx-compat, validation
  jobs/                 auto-scheduler, geo-sweeper
  features/
    auth/               auth.ts (middleware, RBAC), auth.routes.ts (endpoints)
    bd-matrix/          bdMatcher.ts, bd-matrix-utils.ts
    capacity/           capacity-processor.ts, employee-fit.ts, service-delivery-rules.ts
    cancelled-visits/   cancelled-visits.ts, cancelled-visits-from-gh.ts
    imports/            excel-visit-extractor.ts
    travel/             travel-time-service.ts
    people-planner/     automation-engine.ts, automation-routes.ts, report-configs.ts
  controllers/          thin route handlers (bd-matcher, debug, enquiry, geo, history,
                        process, schedule, travel-times, visits)
  middleware/           error-handler, require-auth, require-role
  repositories/         DB query functions per entity
  routes/               Express route registration (bd-matcher, capacity-outlook,
                        debug, enquiries, geo, history, hr.routes, leaver-report,
                        process, schedule, state, travel-times, visits)
  services/             business logic (bd-matcher.service.ts)
  utils/                helpers.ts (resolveBranch, etc.)
  storage.ts            IStorage interface + DbStorage
  pipeline.ts           Excel parsing + capacity calculation
  app.ts                Express app setup + global /api auth guard
  index.ts              Entry point, session store, server bootstrap
```

---

## Key Files

| File | Role |
|---|---|
| `shared/schema.ts` | All DB tables, Zod schemas, shared TypeScript types |
| `server/app.ts` | Express setup, global `/api` auth guard, public route exceptions |
| `server/pipeline.ts` | Excel parsing, capacity calculation |
| `server/storage.ts` | IStorage interface + DbStorage + MemStorage |
| `server/features/auth/auth.ts` | Auth middleware, `requireRole`, `requireRoleAtLeast`, `auditLog`, admin seed |
| `server/features/auth/auth.routes.ts` | Auth + user management API |
| `server/features/travel/travel-time-service.ts` | Multi-API travel time logic |
| `server/features/people-planner/automation-engine.ts` | Playwright automation |
| `server/features/capacity/capacity-processor.ts` | Net capacity algorithm |
| `server/features/capacity/service-delivery-rules.ts` | Service type inclusion/exclusion |
| `server/utils/helpers.ts` | `resolveBranch()` — authoritative branch membership check |
| `client/src/utils/scheduling-engine.ts` | VRPTW engine (runs client-side) |
| `client/src/utils/scheduling-utils.ts` | Travel cache, Haversine heuristic, constants |
| `client/src/utils/scheduling-scoring.ts` | Visit-employee scoring weights |
| `client/src/utils/drag-drop-engine.ts` | Drop validation, visit insertion |
| `client/src/components/weekly-plan-tab.tsx` | Schedule UI + drag-drop + walker refinement |
| `client/src/components/PeoplePlannerPanel.tsx` | Automation trigger panel + polling |
| `client/src/contexts/AuthContext.tsx` | Global auth state, `useAuth()` hook |
| `client/src/contexts/BranchContext.tsx` | Active branch state, `useBranch()` hook |
| `client/src/pages/dashboard.tsx` | Main multi-tab dashboard |
| `client/src/pages/capacity-outlook.tsx` | Joiner/Leaver pipeline + monthly tracker |
| `client/src/pages/workforce.tsx` | HR calendar grid |
| `client/src/pages/bd-matrix.tsx` | BD heatmap + enquiry matcher |
| `client/src/pages/admin.tsx` | User management + audit log |

---

## Database Schema

All tables live in `shared/schema.ts`. Every operational table is scoped to `branchId`.

---

### Core / Identity

#### `users`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `email` | text unique | Login identifier |
| `username` | text | |
| `passwordHash` | text | bcrypt hash |
| `displayName` | text | |
| `role` | text | `admin` \| `manager` \| `supervisor` \| `viewer` — default `viewer` |
| `isActive` | integer | 1 = active |
| `supabaseUserId` | text | Supabase auth UID |
| `legalConsentVersion` | text | Accepted legal doc version |
| `legalConsentAt` | timestamp | |
| `createdAt` | timestamp | |

#### `branches`
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `name` | text unique | Slug identifier |
| `displayName` | text | Human-readable label |
| `createdAt` | timestamp | |

#### `user_branches` (many-to-many join)
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | UUID FK → `users.id` | |
| `branchId` | UUID FK → `branches.id` | |

Unique constraint on `(userId, branchId)`.

#### `session`
Managed by `connect-pg-simple`. Columns: `sid` (PK), `sess` (JSONB), `expire`.

#### `audit_logs`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `userId` | UUID FK → `users.id` | |
| `userEmail` | text | Denormalised for readability |
| `branchId` | UUID | |
| `action` | text | e.g. `upload`, `schedule_generate` |
| `detail` | text | Free-form context |
| `timestamp` | timestamp | |

#### `feedback`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `type` | text | `bug` \| `general` |
| `title` | text | |
| `description` | text | |
| `stepsToReproduce` | text | Bug reports only |
| `submittedByEmail` | text | |
| `branchId` | UUID | |
| `submittedAt` | timestamp | |

---

### Operational & Capacity

#### `capacity_analyses`
One row per branch/week. Stores the full processed output of the People Planner import.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `weekStartDate` | text | ISO date (Monday) |
| `weekEndDate` | text | ISO date (Sunday) |
| `uploadedAt` | timestamp | |
| `kpis` | JSONB | Top-level weekly metrics |
| `dailySummary` | JSONB | Per-day aggregates |
| `employeesByDate` | JSONB | Full employee detail per day |
| `employeeSummaryByDate` | JSONB | Summary per employee per day |
| `warnings` | JSONB | Processing warnings |
| `ghLossRawSummary` | JSONB | Guaranteed hours loss detail |

Unique constraint on `(branchId, weekStartDate)`. Re-uploading same week overwrites.

#### `branch_uploads`
Stores raw Excel files for re-processing without re-upload.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `uploadType` | enum | `guaranteedHours` \| `availability` \| `demand` \| `cgData` |
| `fileBuffer` | text | Base64-encoded file |
| `originalFileName` | text | |
| `fileSize` | integer | Bytes |
| `sha256` | text | Dedup key |
| `uploadedAt` | timestamp | |

Unique constraint on `(branchId, uploadType)` — each type keeps only the latest file.

#### `employee_hr_calendar`
One row per employee per date. Drives the Workforce calendar and backfills into capacity calculations.

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `employeeKey` | text | Stable identifier across uploads |
| `employeeName` | text | |
| `date` | text | ISO date |
| `status` | text | `available`, `sick`, `holiday`, `awol`, `resigned`, etc. |
| `source` | text | `people_planner` \| `manual` |
| `notes` | text | Manual entry notes |
| `contractedHours` | numeric | Hours contracted that day |
| `transportMode` | text | `car` \| `walking` \| `public` |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

Unique constraint on `(branchId, employeeKey, date)`.

---

### Geographical & Scheduling

#### `employee_locations`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `employeeName` | text | |
| `homePostcode` | text | |
| `homeLat` | numeric | |
| `homeLng` | numeric | |
| `transportMode` | enum | `car` \| `walking` \| `public` |
| `gender` | enum | `male` \| `female` |
| `geocodedAt` | timestamp | |

#### `client_locations`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `clientName` | text | |
| `addressLine` | text | |
| `postcode` | text | |
| `lat` | numeric | |
| `lng` | numeric | |
| `geocodedAt` | timestamp | |

#### `visits`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `clientId` | FK → `client_locations.id` | |
| `date` | text | ISO date |
| `durationMinutes` | integer | |
| `preferredStartTime` | text | HH:MM |
| `preferredEndTime` | text | HH:MM |
| `priority` | integer | Lower = higher priority |
| `serviceType` | text | |
| `createdAt` | timestamp | |

#### `route_plans`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `date` | text | ISO date |
| `employeeId` | FK → `employee_locations.id` | |
| `totalDistanceKm` | numeric | |
| `totalTravelMinutes` | numeric | |
| `status` | text | `draft` \| `confirmed` |
| `warnings` | JSONB | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

#### `route_stops`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `routePlanId` | FK → `route_plans.id` | |
| `visitId` | FK → `visits.id` | |
| `sequence` | integer | Order within the route |
| `scheduledStart` | text | HH:MM |
| `scheduledEnd` | text | HH:MM |
| `travelMinutesFromPrev` | numeric | |
| `distanceKmFromPrev` | numeric | |

#### `weekly_schedules`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `weekStartDate` | text | ISO date |
| `weekEndDate` | text | ISO date |
| `generatedAt` | timestamp | |
| `scheduleData` | JSONB | Full assignment map |
| `unallocatedVisits` | JSONB | Visits that could not be assigned |
| `metrics` | JSONB | Allocation rate, travel averages, etc. |

#### `geocode_cache`
Caches postcode → lat/lng results. Scoped by `branchId`.

#### `travel_time_cache`
Caches travel time results between origin/destination pairs. Session-level cache supersedes this for active scheduling runs. DB cache disabled for car routes.

---

### Business Intelligence & CRM

#### `client_enquiries`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `clientName` | text | |
| `postcode` | text | |
| `genderPreference` | text | |
| `requiredDays` | JSONB | Array of day strings |
| `preferredTimeWindow` | JSONB | `{start, end}` |
| `matchCount` | integer | Number of viable Care Pros found |
| `topMatch` | text | Name of best matching Care Pro |
| `results` | JSONB | Full match result set |
| `starredSelections` | JSONB | User-starred matches |
| `visits` | JSONB | Multi-visit configuration |
| `isMultiVisit` | boolean | |
| `visitDurationMinutes` | integer | |
| `createdAt` | timestamp | |

#### `cp_scheduled_visits`
Derived data from CarePro Excel export. Used for visit matching and BD matrix population. Scoped by `branchId`.

#### `gh_client_visits`
Derived data from Guaranteed Hours Excel export. Maps GH contracts to scheduled visits. Scoped by `branchId`.

#### `branch_scheduling_preferences`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` unique | |
| `excludedServiceTypes` | text[] | Service types excluded from scheduling |
| `updatedAt` | timestamp | |

---

### Capacity Outlook

#### `leavers`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `employeeName` | text | |
| `employeeNo` | text | |
| `gender` | text | |
| `employmentType` | text | `driver` \| `walker` |
| `weeklyHours` | numeric | Hours that will be lost |
| `contractedHours` | numeric | |
| `postcode` | text | |
| `firstDayOfNotice` | text | ISO date |
| `lastWorkingDay` | text | ISO date |
| `notes` | text | |
| `status` | text | `active` \| `processed` |
| `createdBy` | UUID FK → `users.id` | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

#### `joiners`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `candidateName` | text | |
| `gender` | text | |
| `employmentType` | text | `driver` \| `walker` |
| `desiredWeeklyHours` | numeric | |
| `contractedHours` | numeric | Set when hired |
| `postcode` | text | |
| `trainingDate` | text | ISO date |
| `expectedStartDate` | text | ISO date |
| `completedStages` | text[] | Milestones achieved |
| `stage` | text | Current pipeline stage |
| `status` | text | `active` \| `hired` \| `archived` |
| `hiredAt` | timestamp | |
| `confidenceWeight` | numeric | 0–1; used in pipeline KPI calculation |
| `notes` | text | |
| `createdBy` | UUID FK → `users.id` | |
| `createdAt` | timestamp | |
| `updatedAt` | timestamp | |

#### `monthly_capacity_snapshots`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `branchId` | UUID FK → `branches.id` | |
| `year` | integer | |
| `month` | integer | 1–12 |
| `hoursIn` | numeric | Hours gained (joiners hired) |
| `headsIn` | integer | Head count added |
| `hoursOut` | numeric | Hours lost (leavers) |
| `headsOut` | integer | Head count removed |
| `snapshotCreatedAt` | timestamp | |

#### `leaver_report_recipients`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `email` | text unique | |
| `addedAt` | timestamp | |

---

## Authentication & RBAC

Enterprise auth via express-session + bcrypt. Roles: `admin > manager > supervisor > viewer`.

- **Seeding admin**: Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in Replit Secrets, plus `SESSION_SECRET`. On startup the server creates the admin user if it doesn't exist.
- `server/features/auth/auth.ts`: `requireAuth`, `requireRole`, `requireRoleAtLeast`, `auditLog` middleware
- `server/features/auth/auth.routes.ts`: Auth + user management API
- `client/src/contexts/AuthContext.tsx`: global auth state, `useAuth()` hook
- `client/src/pages/login.tsx`: enterprise login page
- `client/src/pages/admin.tsx`: user management + audit log (admin only)
- `shared/schema.ts`: `users`, `userBranches`, `auditLogs` tables

**Global auth guard** (`server/app.ts`): all `/api/*` routes require a valid session by default.

Public exceptions: `/api/auth/*`, `/api/branches`, `/health`, `/robots.txt`.

---

## API Endpoints

### Auth & User Management

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/branches` | Public | List all branches |
| POST | `/api/auth/login` | Public | Authenticate, create session |
| POST | `/api/auth/logout` | Session | Destroy session |
| GET | `/api/auth/me` | Session | Current user profile |
| POST | `/api/auth/forgot-password` | Public | Request password reset email |
| POST | `/api/auth/reset-password` | Public | Reset password with token |
| POST | `/api/auth/accept-legal` | Session | Record legal consent |
| GET | `/api/admin/users` | Admin | List all users + branch assignments |
| POST | `/api/admin/users` | Admin | Create user |
| PATCH | `/api/admin/users/:userId` | Admin | Update user / role / reset password |
| GET | `/api/admin/audit-logs` | Admin | Fetch audit log |

### People Planner Automation

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/pp/status` | Session | All automation slot statuses |
| POST | `/api/pp/run` | Scheduler | Trigger single-week capacity sync |
| POST | `/api/pp/run-multi-week` | Scheduler | Trigger multi-week forward sync |
| GET | `/api/pp/sessions` | Session | List recent automation sessions |
| GET | `/api/pp/sessions/:id` | Session | Session progress + per-job detail |
| GET | `/api/pp/config` | Session | Branch PP configuration |
| POST | `/api/pp/config/:branchId` | Admin | Update branch PP config |
| GET | `/api/pp/scheduler` | Session | Scheduler status (enabled, next run) |
| POST | `/api/pp/scheduler` | Admin | Toggle / update scheduler settings |
| POST | `/api/pp/trigger-weekly-sync` | Admin | Manually sync all branches |
| POST | `/cron/sync` | Bearer token | Internal scheduled sync trigger |

### Capacity Processing & Export

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/process` | Scheduler | Upload + process Excel capacity files |
| GET | `/api/export` | Session | Download capacity dashboard as Excel |

### Capacity Outlook — Leavers

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/capacity-outlook/leavers` | Session | List leavers for a branch |
| POST | `/api/capacity-outlook/leavers` | Scheduler | Create leaver record |
| PUT | `/api/capacity-outlook/leavers/:id` | Scheduler | Update leaver record |
| DELETE | `/api/capacity-outlook/leavers/:id` | Scheduler | Delete leaver record |

### Capacity Outlook — Joiners

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/capacity-outlook/joiners` | Session | List joiners for a branch |
| POST | `/api/capacity-outlook/joiners` | Scheduler | Create joiner record |
| PUT | `/api/capacity-outlook/joiners/:id` | Scheduler | Update joiner stage / milestones |
| DELETE | `/api/capacity-outlook/joiners/:id` | Scheduler | Delete joiner record |

### Capacity Outlook — Aggregate & Monthly

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/capacity-outlook` | Session | Weekly aggregate outlook |
| GET | `/api/capacity-outlook/detail` | Session | Detailed weekly breakdown |
| GET | `/api/capacity-outlook/monthly` | Session | Saved monthly snapshots vs live |
| PUT | `/api/capacity-outlook/monthly/:year/:month` | Scheduler | Update / close a monthly snapshot |
| DELETE | `/api/capacity-outlook/monthly/:year/:month` | Scheduler | Reopen a closed month |
| GET | `/api/capacity-outlook/cumulative-kpi` | Session | All-time cumulative KPIs |

### HR Calendar (Workforce Tab)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/hr/calendar` | Session | Workforce calendar for a month |
| GET | `/api/hr/employee/:key/summary` | Session | Employee capacity summary for a month |
| GET | `/api/hr/employee/:key` | Session | Detailed employee work history |
| POST | `/api/hr/manual` | Scheduler | Add manual HR entry (sick, holiday, etc.) |
| PUT | `/api/hr/manual/:id` | Scheduler | Update manual HR entry |
| DELETE | `/api/hr/manual/:id` | Scheduler | Delete manual HR entry |
| POST | `/api/hr/manual/bulk` | Scheduler | Bulk create HR entries |
| POST | `/api/hr/backfill` | Admin | Backfill HR records from history |
| GET | `/api/hr/export` | Session | Export workforce calendar to Excel |

### Scheduling & Visits

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/weekly-schedule/generate` | Scheduler | Generate a new weekly schedule |
| GET | `/api/weekly-schedule/latest` | Session | Latest generated schedule |
| GET | `/api/weekly-schedule/:weekStartDate` | Session | Schedule by week start date |
| POST | `/api/weekly-schedule/save` | Scheduler | Save a schedule |
| GET | `/api/visits/week/:weekStart` | Session | Visits for a week |
| GET | `/api/visits/:date` | Session | Visits for a specific date |
| GET | `/api/visits` | Session | Visits between date range |
| POST | `/api/schedule/auto-day` | Scheduler | Auto-schedule a single day |
| POST | `/api/schedule/auto-week` | Scheduler | Auto-schedule a full week |
| GET | `/api/schedule/week/:startDate` | Session | Retrieve schedule for a week |

### BD Matcher

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/bd-matcher` | Session | Match a single visit against Care Pros |
| POST | `/api/bd-matcher/multi-visit` | Session | Match multiple visits |

### Geo, Routing & Travel

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/geo/geocode-batch` | Scheduler | Geocode multiple addresses |
| GET | `/api/geo/postcode/:postcode` | Session | Geocode a single postcode |
| POST | `/api/routing/distance-matrix` | Scheduler | Travel distance matrix |
| POST | `/api/routing/optimize` | Scheduler | Route optimisation |
| GET | `/api/routing/plans` | Session | Saved routing plans |
| GET | `/api/geographical/employees` | Session | Employee locations for mapping |
| GET | `/api/geographical/clients` | Session | Client locations for mapping |
| GET | `/api/locations` | Session | All known locations |
| POST | `/api/travel-times/batch` | Scheduler | Bulk travel time calculations (ORS pre-warm) |
| POST | `/api/travel-times/refine-walker` | Scheduler | Post-schedule walker refinement (TravelTime) |
| POST | `/api/travel-times/debug-single` | Admin | Debug travel time between two points |

### Client Enquiries

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/client-enquiries` | Session | List enquiries |
| POST | `/api/client-enquiries` | Session | Create enquiry |
| DELETE | `/api/client-enquiries/:id` | Scheduler | Delete enquiry |
| PATCH | `/api/client-enquiries/:id/stars` | Session | Update starred matches |

### Leaver Report

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/leaver-report/recipients` | Admin | List email recipients |
| POST | `/api/leaver-report/recipients` | Admin | Add recipient |
| DELETE | `/api/leaver-report/recipients/:id` | Admin | Remove recipient |
| POST | `/api/leaver-report/send` | Admin | Manually trigger leaver report email |

### Maintenance & Debug

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | Public | Health check (DB + uptime) |
| GET | `/api/history` | Session | Processing history logs |
| GET | `/api/history/latest` | Session | Latest history entry |
| GET | `/api/history/range/:start/:end` | Session | History within date range |
| POST | `/api/cleanup` | Admin | Delete old history data |
| GET | `/api/cleanup/preview/:months` | Admin | Preview cleanup candidates |
| POST | `/api/cleanup/routes-visits` | Admin | Clean up old route and visit records |
| GET | `/api/debug/employee-comparison` | Admin | Compare employee data across sources |
| POST | `/api/admin/re-geocode-clients` | Admin | Re-geocode all client addresses |
| GET | `/api/feedback` | Admin | List submitted feedback |
| POST | `/api/feedback` | Session | Submit feedback |

---

## Frontend Pages & Tabs

### Route Map (`client/src/App.tsx`)

| Path | Component | Description |
|---|---|---|
| `/` | `dashboard.tsx` | Main dashboard (Overview + Daily View) |
| `/bd-matrix` | `bd-matrix.tsx` | BD availability heatmap + enquiry tool |
| `/schedule` | `schedule/index.tsx` | Weekly plan view |
| `/capacity-outlook` | `capacity-outlook.tsx` | Joiner/Leaver pipeline + monthly tracker |
| `/workforce` | `workforce.tsx` | HR calendar grid |
| `/admin` | `admin.tsx` | User management + audit log |
| `/login` | `login.tsx` | Enterprise login |
| `/reset-password` | `reset-password.tsx` | Password reset (token from email) |
| `/data-management` | `data-management.tsx` | Branch upload management |
| `/docs` | `docs.tsx` | In-app user documentation |
| `/privacy-policy` | `privacy-policy.tsx` | |
| `/cookie-policy` | `cookie-policy.tsx` | |
| `/terms` | `terms.tsx` | |

---

### Dashboard (`/`)

Two sub-tabs rendered inside `dashboard.tsx`.

#### Overview Tab (`OverviewTab.tsx`)
- **KPI cards**: Desired Total Hours, Guaranteed Hours, Net Capacity, Client Demand, Client Scheduled, Capacity After Scheduling.
- **Weekly breakdown**: Sickness hours, Unavailability hours, Holiday hours, GH Loss.
- **Last sync indicator**: Timestamp of the last People Planner import.
- **Week selector**: Navigate to any available week; defaults to the current calendar week.
- **Drill-down modals**: Click any metric card to see the individual employee list behind it.
- **Upload panel**: Manual Excel upload (Availability, Guaranteed Hours, CG Data).
- **People Planner panel**: Trigger automated sync; appears prominently when no data is loaded.

#### Daily Capacity Tab (`DailyCapacityTab.tsx`)
- **Summary table**: One row per day — Desired Hours, Unavailability, Sickness, Holidays, Net Capacity, Client Required, Client Scheduled, Other Scheduled.
- **Employee drilldown**: Click a day row to expand all employees for that day with status, time windows, and individual capacity.
- **Search & filter**: Filter employees by name or status.

---

### BD Availability Matrix (`/bd-matrix`)
- **Heatmap grid**: Days × time blocks (11 fixed 60-minute blocks). Cell values = count of available Care Pros.
- **Employee list**: Care Pros in any selected block with transport mode and gender.
- **Map view**: Leaflet map of employee and client locations.
- **Client Enquiry Matcher**: Enter new client requirements; returns ranked Care Pro matches with coverage %, gender match, and postcode proximity.
- **Multi-visit mode**: Match multiple visit slots in a single enquiry.
- **Starred selections**: Save preferred matches per enquiry.

---

### Schedule (`/schedule`)
- **Weekly plan grid** (`WeeklyPlanTab.tsx`): One column per employee, visits shown as time blocks.
- **Unallocated visits panel**: Visits that could not be assigned, shown below the grid.
- **Drag-and-drop assignment**: Drag an unallocated visit to an employee column; valid drops highlighted green, invalid red with a reason toast.
- **Walker refinement**: Post-schedule TravelTime API call replaces Haversine estimates for walker/public pairs.
- **Save & export**: Save schedule to DB; export to PDF.

---

### Capacity Outlook (`/capacity-outlook`)
- **Cumulative KPI banner**: Net capacity change, pipeline weighted hours, RAG risk status.
- **Joiners table**: Full recruitment pipeline with stage badges, confidence scores, milestone tracking. Add / Edit / Delete / Archive.
- **Leavers table**: Upcoming terminations with notice dates and hours impact. Add / Edit / Delete.
- **Monthly tracker**: Months showing saved snapshot vs live data (hours in/out, heads in/out). Close month to lock snapshot; Reopen to amend.
- **History charts**: Cumulative net capacity and month-by-month in/out bars.

---

### Workforce (`/workforce`)
- **Monthly grid**: Employee names × days of the month. Color-coded cells by status.
- **Status legend**: Available (green), Sick (red), Holiday (blue), AWOL (orange), Resigned, etc.
- **Employee side sheet**: Opens on row click — 6-month absence history chart for the individual.
- **Month/year navigation**: Step forward or backward by month.
- **Name/status filter**: Filter the grid in real time.
- **Excel export**: Download the full monthly calendar as an Excel workbook.

---

### Admin (`/admin`)
- **User management table**: Create, edit, deactivate users. Assign branches. Reset passwords.
- **Audit log**: Paginated list of all system actions with user, branch, action, timestamp.
- **Leaver report recipients**: Manage email addresses that receive the monthly leaver summary.

---

## Data Pipeline

`parseExcelFiles` in `server/pipeline.ts` returns two datasets:
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

8. **Persistence** — Processed result stored as weekly snapshot keyed by branch and week start date. Re-uploading same week overwrites. Historical snapshots retained indefinitely.

### Name Normalisation

`normaliseName` in `server/features/capacity/` (shared by `pipeline.ts`):

1. Lowercase
2. Strip parenthetical annotations including GH tags — `(24 GH)`, `24 GH`
3. Remove title prefixes: `Mr`, `Mrs`, `Dr`, etc.
4. Remove non-alpha characters
5. Split on whitespace
6. Sort tokens alphabetically
7. Rejoin

Result: `"Smith, Jane (24 GH)"` and `"Jane Smith"` both → `"jane smith"`

**Critical**: `normaliseName` must stay in sync between server and client (`dashboard-utils.tsx`). Divergence causes cross-file matching failures.

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

`geocodeWithFallback`:

- Primary: `postcodes.io` lookup
- Terminated postcode fallback: on 404, extracts `terminated.latitude/longitude` from the response body
- Failed geocodes are logged and retried on next startup sweep (geo-sweeper job)
- Known unresolvable postcodes (wrong/non-existent in People Planner): `G63 6HU`, `G62 3BZ`, `ML6 5AZ`

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

1. **Pre-processing**: Office/shadowing visits excluded. Client visits geographically clustered (~2 km grid cells).
2. **Walker-first pass**: Walking staff assigned first using strict proximity rules (same postcode sector or < 1.5 km from client).
3. **Greedy assignment loop**: Remaining visits scored against every available employee. Highest-scoring feasible assignment committed before moving to next visit.
4. **Break injection**: After assignment, scanner finds shifts > 5 continuous hours and inserts mandatory 30-minute breaks where a natural gap exists.

### Scoring Function

| Weight | Factor | Description |
|---|---|---|
| 40% | Window slack | Prefers assignments fitting snugly within a window — avoids large unusable gaps |
| 25% | Travel added | Penalises assignments significantly increasing daily travel time |
| 25% | Home proximity | Prefers placing first/last visit closer to employee's home postcode |
| 10% | Run tightness | Slightly favours smaller inter-visit gaps for dense care runs |

GH employees receive a `GH_SCORE_BONUS` of **0.45** to ensure contracted hours are preferentially filled before ad-hoc capacity.

### Hard Constraints

- Visit must fit within employee's free window (10-minute tolerance on start time)
- No overlapping visits — assignments strictly chronological
- Daily care hours cap: 9 hours maximum
- Weekly hours cap: contracted hours + 30-minute overage buffer
- Travel time between consecutive visits must not exceed the gap between them
- Travel cap: car 45 min, walker/public 60 min — visits exceeding cap go to unallocated
- Gender matching: hard filter where client name contains `(F)` or `(M)` preference
- Sleep-in and Secondary visits skipped — require separate staffing logic

### Drag-Drop Visit Assignment

`client/src/utils/drag-drop-engine.ts`:
- `validateVisitDrop(visit, employee, schedule)` — checks time windows, daily capacity, and travel caps. Returns a reason string on rejection.
- `buildAssignedVisit(visit, employee, travelTime)` — constructs the assigned visit object.
- `findInsertionIndex(employeeSchedule, newVisit)` — inserts visit chronologically.

UI in `weekly-plan-tab.tsx`: uses `@dnd-kit/core`. On drag start, all employees are pre-validated; the drop zone panel shows green (valid) or red (invalid) per employee. On valid drop: visit inserted, schedule auto-saved, toast shown.

---

## Travel Time Logic

`server/features/travel/travel-time-service.ts`

### API Hierarchy

| Priority | API | Modes | Use case |
|---|---|---|---|
| 1 | ORS Matrix | Car | Pre-warm batch before scheduling — all employee × client pairs |
| 2 | ORS Directions | Car | Single-pair fallback |
| 3 | OSRM | Car | Free fallback when ORS quota exhausted |
| 4 | TravelTime | Walker, Public | Post-schedule refinement for assigned pairs |
| 5 | Haversine | All | Phase-1 scheduling estimate / last resort |

### Haversine Heuristic

```
distance = haversine(origin, destination) × 1.2  (road factor)
```

Speed assumptions:
- Car: 35 km/h, minimum 5 min
- Public: 15 km/h + 15 min overhead, minimum 15 min
- Walking: 5 km/h, minimum 2 min

### Two-Phase Walker

- **Phase 1**: Haversine estimates used during initial scheduling (instant).
- **Phase 2**: `POST /api/travel-times/refine-walker` — calls TravelTime API for only the assigned walker/public pairs. Pairs deduplicated by `{visitDate}-{from}-{to}-{mode}`. Different days get separate queries (weekend timetables). Results stored in a local date-keyed map, not the global session cache — avoids cross-day contamination.

### Cache Layers

1. **Session cache** (`travelTimeCache`) — in-memory per scheduling run. Primary lookup.
2. **Date-keyed walker cache** — keyed by `{visitDate}-{from}-{to}-{mode}`. Prevents cross-day contamination.
3. **DB cache** (`travel_time_cache`) — disabled for car routes; session cache only.

### Caps

- Car: 45 min (`MAX_TRAVEL_TIME_MINUTES`)
- Walker/public: 60 min (`MAX_TRAVEL_TIME_MINUTES_WALKER`)
- `TRAVEL_COMPRESSION_ALLOWANCE = 0` — strict; no compression
- ORS 9999 → visit sent to unallocated

---

## Capacity Outlook

### Joiner Pipeline

**Stages (in order):**
`Application` → `Interview` → `Offer` → `PVG` → `Onboarding` → `Training` → `Shadow` → `Hired`

**Confidence weights by stage:**

| Stage | Weight |
|---|---|
| Application | 0.10 |
| Interview | 0.20 |
| Offer | 0.40 |
| PVG | 0.55 |
| Onboarding | 0.65 |
| Training | 0.80 |
| Shadow | 0.90 |
| Hired | 1.00 |

**Pipeline KPI formula:**
```
weightedPipelineHours = Σ (joiner.desiredWeeklyHours × joiner.confidenceWeight)
```
Only `active` and `hired` joiners are included. `archived` joiners are excluded.

### Monthly Snapshots

Each snapshot records the net movement for a calendar month:
- `hoursIn` / `headsIn` — from joiners reaching `Hired` status that month
- `hoursOut` / `headsOut` — from leavers whose `lastWorkingDay` falls that month

Snapshots can be **closed** (locked) to prevent overwrite, and **reopened** to amend. Closed months show as final figures; open months show live recalculated figures.

### Cumulative KPIs

`GET /api/capacity-outlook/cumulative-kpi` computes:
- Total hours in (all time, by branch)
- Total hours out (all time, by branch)
- Net change
- RAG status: Green (net ≥ 0), Amber (net ≥ −20), Red (net < −20)

---

## Workforce / HR Calendar

### Data Source Priority

For each employee/date cell, the displayed status comes from (highest priority first):
1. Manual HR entry (`source = manual`) — entered directly in the Workforce tab
2. People Planner sync (`source = people_planner`) — written during `POST /api/process` or PP automation

### Manual Entry Modes
- **Single entry**: One employee, one date, one status.
- **Bulk entry**: Multiple employees and/or multiple dates in one operation (`POST /api/hr/manual/bulk`).

### Backfill
`POST /api/hr/backfill` replays all historical `capacity_analyses` records and writes `people_planner`-sourced entries to `employee_hr_calendar`. Used when the HR calendar is first introduced for a branch that already has historical data.

### Export
`GET /api/hr/export` streams an Excel workbook: one sheet per month, columns = days, rows = employees, cells = status abbreviations.

---

## Leaver Email Report

Sends a monthly summary of registered leavers to configured recipients.

- **Transport**: Resend API (`RESEND_API_KEY` env var).
- **Trigger**: Manual (`POST /api/leaver-report/send`) or automated monthly schedule.
- **Recipients**: Managed via `leaver_report_recipients` table. `LEAVER_REPORT_EMAILS` env var used as fallback if no DB recipients are configured.
- **Content**: List of leavers per branch with name, last working day, and hours lost.

---

## People Planner Automation

### Files

| File | Purpose |
|---|---|
| `server/features/people-planner/automation-engine.ts` | Playwright-controlled Chromium; login, navigation, report download |
| `server/features/people-planner/report-configs.ts` | Per-report URL, field config, export template names |
| `server/features/people-planner/automation-routes.ts` | Express routes under `/api/pp/` |

### Three Reports Downloaded Per Sync

| Report | `uploadType` | Contents |
|---|---|---|
| Availability | `availability` | Care Pro availability windows by day |
| Guaranteed Hours | `guaranteedHours` | GH contract hours per employee |
| CG Data | `cgData` | Master employee list with transport mode, contracted hours |

### Pipeline Steps

1. Session init — Playwright Chromium → Access Identity login → session cookies saved
2. Branch context — navigate to configured branch workspace URL
3. Application launch — open People Planner from Access launcher; wait for full load
4. Triple report download — in sequence: Guaranteed Hours → CG Data → Availability
5. Data processing — Excel buffers passed to same parsing functions as manual upload
6. Persistence — processed snapshot upserted into `capacity_analyses`

**Sensitivity**: Pipeline is sensitive to UI changes in Access People Planner. Monitor session log after each run, especially following Access platform updates.

### Account Slot Mapping

Each Access Workspace account has permission to access specific branches only.

| Env var | Slot | Branches covered |
|---|---|---|
| `ACCESS_EMAIL` | 0 | All branches (fallback) |
| `ACCESS_EMAIL_1` | 1 | Glasgow North |
| `ACCESS_EMAIL_2` | 2 | Aberdeen, West Fife / Dunfermline |
| `ACCESS_EMAIL_3` | 3 | Ayr & Kilmarnock, East Lothian & Midlothian, Scottish Borders |
| `ACCESS_EMAIL_4` | 4 | North Lanarkshire, Glasgow South |
| `ACCESS_EMAIL_5` | 5 | Stirling & Falkirk, Perth |

Branches from different groups run in parallel. Branches sharing a slot fall back to slot 0 if their preferred slot is busy, or queue if both are occupied.

### Multi-Week Sync
`POST /api/pp/run-multi-week` runs a single Playwright session that iterates over a configurable number of forward weeks (default: 8) for a branch, re-processing each week in sequence.

### Frontend Panel
`client/src/components/PeoplePlannerPanel.tsx`:
- Sheet-based panel with week date picker.
- Per-report status indicators and progress bar.
- Polls `GET /api/pp/sessions/:id` every 2 seconds.

---

## Key Constants

| Constant | Value | Location | Purpose |
|---|---|---|---|
| `MAX_DAILY_CARE_HOURS` | 9 hours | `scheduling-engine.ts` | Daily capacity ceiling per employee |
| `MAX_TRAVEL_TIME_MINUTES` | 45 min | `scheduling-utils.ts` | Car travel cap |
| `MAX_TRAVEL_TIME_MINUTES_WALKER` | 60 min | `scheduling-utils.ts` | Walker/public travel cap |
| `TRAVEL_COMPRESSION_ALLOWANCE` | 0 | `scheduling-utils.ts` | No time compression — strict gap checking |
| `TIME_FLEXIBILITY_MINUTES` | 10 min | `scheduling-engine.ts` | Availability window edge tolerance |
| `GH_SCORE_BONUS` | 0.45 | `scheduling-engine.ts` | Score boost for Guaranteed Hours staff |
| `BREAK_THRESHOLD_MINUTES` | 300 min (5h) | `scheduling-engine.ts` | Work duration before statutory break |
| `BREAK_DURATION_MINUTES` | 30 min | `scheduling-engine.ts` | Statutory break length |
| ORS batch size | 50 pairs | `travel-time-service.ts` | ORS Matrix pairs per request |
| Walker cluster radius | 1.5 km | `scheduling-engine.ts` | Proximity radius for walker assignment |
| Grid cell size | ~2 km | `scheduling-engine.ts` | Visit clustering granularity |
| PP poll interval | 2 seconds | `PeoplePlannerPanel.tsx` | Session status polling frequency |
| BD enquiry block search | 150 min | `bdMatcher.ts` | Search window when no exact block match |
| BD outbound tolerance | 20 min | `bdMatcher.ts` | Maximum late-arrival tolerance for next visit |

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
| `RESEND_API_KEY` | Resend API key for sending automated emails |
| `LEAVER_REPORT_EMAILS` | Comma-separated fallback recipient list if no DB recipients configured |
| `ACCESS_EMAIL` | People Planner account slot 0 (required, all-branch fallback) |
| `ACCESS_PASSWORD` | Password for slot 0 |
| `ACCESS_EMAIL_1` … `ACCESS_EMAIL_5` | People Planner account slots 1–5 (optional) |
| `ACCESS_PASSWORD_1` … `ACCESS_PASSWORD_5` | Passwords for slots 1–5 |
| `PEOPLE_PLANNER_BRANCH_CONFIG` | JSON map of `branchId → {workspaceBranch, plannerArea}` |

---

## Multi-Branch Model

- Every DB query is scoped to `branchId`.
- `BranchContext` (`client/src/contexts/BranchContext.tsx`) provides the active branch globally throughout the React app.
- `resolveBranch()` in `server/utils/helpers.ts` is the authoritative server-side helper: validates the requested branch exists and, for non-admin users, confirms the user is assigned to that branch.
- Any branch-scoped route that accepts `branchId` without calling `resolveBranch()` is a security review target — see `threat_model.md`.
- Admins can access all branches. All other roles are restricted to their assigned branches via `user_branches`.
