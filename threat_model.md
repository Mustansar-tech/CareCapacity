# Threat Model

## Project Overview

A multi-branch **Care Capacity Dashboard** for Home Instead UK franchise managers. Built with React/TypeScript + Vite (frontend), Express (backend), and PostgreSQL via Drizzle ORM (database). Deployed on Replit autoscale.

The system ingests weekly Excel exports from Access People Planner, runs a capacity-modelling and scheduling pipeline, and exposes the results through four modules: a capacity dashboard, a BD (Business Development) availability matrix, an auto-scheduler, and a People Planner automation layer that drives a headless Playwright browser to extract reports without manual export.

**Users:** Branch managers (schedulers), business development staff, and admin users. The app is not public-facing — access is intended for internal staff only.

**Sensitive data in scope:**
- Care Pro (employee) full names, home postcodes/coordinates, gender, transport mode, availability windows, sickness, and holiday records
- Client full names, addresses, postcodes/coordinates, visit requirements, care service types (some indicating health conditions)
- System user email addresses and bcrypt-hashed passwords
- External system credentials: Access People Planner login (email + password)
- API keys for routing and scheduling services

**Regulatory context:** UK GDPR (ICO). Health and social care context — sickness records and care visit types (e.g. personal care, sleep-in) may constitute special category data under Article 9. A lawful basis and ROPA entry are required.

---

## Assets

| Asset | Description | Risk if compromised |
|---|---|---|
| **Care Pro PII** | Full names, home postcodes, geocoded coordinates, gender, availability/sickness/holiday records in `employee_locations` and `capacity_analyses` tables | UK GDPR breach notification obligation; home location disclosure harms employees |
| **Client PII** | Full names, addresses, postcodes, coordinates, visit schedules in `client_locations`, `visits`, and `capacity_analyses` | Breach obligation; disclosure of vulnerable adults' locations and care routines |
| **Health-adjacent data** | Sickness records, service type descriptions indicating personal care or health needs | Article 9 special category; heightened accountability |
| **Raw Excel uploads** | Stored as Base64 blobs in `branch_uploads` — contain all of the above in dense form | Single-record extraction yields full employee and client dataset for a branch |
| **User credentials** | Email + bcrypt passwords in `users` table; session tokens in PostgreSQL `session` table | Account takeover; access to all branch data across all modules |
| **Application secrets** | `DATABASE_URL`, `SESSION_SECRET`, `ORS_API_KEY`, `TRAVELTIME_APP_ID`, `TRAVELTIME_API_KEY` | Full database access; session forgery; routing API cost exploitation |
| **People Planner credentials** | `ACCESS_EMAIL` + `ACCESS_PASSWORD` environment variables used by Playwright automation | Full access to People Planner platform; ability to export all employee and client data |
| **PP session file** | `/tmp/pp-access-session.json` — Playwright browser state (cookies, localStorage) for `go.accessacloud.com` and `identity.accessacloud.com` | Live session hijack of People Planner without needing credentials |
| **Processed files on disk** | `capacity_dashboard.xlsx` and PP downloads in `/tmp/pp-automation-downloads/` | PII accessible to any local process with `/tmp` read access |
| **Audit log** | `audit_logs` table: user emails, IPs, action types | Logs contain PII; integrity required for accountability |

---

## Trust Boundaries

### 1. Browser ↔ Express API

All client requests are untrusted. Session authentication is required for protected endpoints via `httpOnly`, `secure` (production), `sameSite: lax` session cookies. PostgreSQL-backed session store with 30-minute rolling expiry.

**Critical finding:** A large number of API routes lack `requireAuth` middleware and are accessible to any unauthenticated caller. See the Elevation of Privilege section for the full list.

### 2. Express API ↔ PostgreSQL

Full read/write access via `DATABASE_URL`. All queries use Drizzle ORM with parameterised statements — no string-concatenated SQL identified. Credentials stored in environment variables only.

### 3. Express API ↔ OpenRouteService (ORS)

Car distance matrices and route optimisation. Sends coordinate pairs (lat/lng) only — no names or postcodes. Authorised via `ORS_API_KEY`. ORS acts as a data processor under UK GDPR — a formal Data Processing Agreement (DPA) should be confirmed before production use.

### 4. Express API ↔ TravelTime API

Walking and public transport travel time estimates. Sends coordinate pairs with `TRAVELTIME_APP_ID` + `TRAVELTIME_API_KEY`. Same DPA requirement as ORS applies.

### 5. Express API ↔ OSRM (router.project-osrm.org)

Free fallback routing when ORS is unavailable. Sends coordinate pairs over HTTPS. Public service — no DPA exists and none is possible. This is the highest-risk third-party data flow from a data protection perspective.

### 6. Express API ↔ Postcodes.io

UK postcode geocoding. Sends postcodes only — no names or addresses. Public service; no API key or DPA required.

### 7. Express API ↔ Access People Planner (Playwright)

The `automation-engine.ts` launches a headless Chromium browser that authenticates to `identity.accessacloud.com` using `ACCESS_EMAIL` and `ACCESS_PASSWORD`, navigates to `go.accessacloud.com`, and downloads Excel reports. Browser session state is persisted to `/tmp/pp-access-session.json` between runs. Downloaded files are staged in `/tmp/pp-automation-downloads/`. The People Planner platform receives the full Access credentials — it is an untrusted external environment from which the application reads.

### 8. Authenticated ↔ Public boundary

- **Public (no auth):** `/api/auth/login`, `/api/auth/me` (returns 401 if not authenticated), `/health`, `/robots.txt`, `/api/branches` — and currently many routes that *should* be authenticated but are not (see below)
- **Authenticated (`requireAuth`):** All `/api/pp/*` routes, `/api/process` (upload), feedback routes
- **Scheduler or above (`requireRoleAtLeast('scheduler')`):** `/api/process` (upload), `/api/pp/run`, `/api/weekly-schedule/generate`, `/api/weekly-schedule/save`
- **Admin only (`requireRole('admin')`):** `/api/admin/*` (user management, audit logs), `/api/pp/config`
- **Disabled in production:** `/api/auth/bootstrap-admin` (returns 404), `/api/auth/reset-admin-password` (not registered)

---

## Scan Anchors

**Production entry points:**
- `server/app.ts` — route registration; primary map of all API surfaces
- `server/index.ts` — session config, rate limiting, middleware stack
- `server/features/auth/auth.ts` — `requireAuth`, `requireRole`, `requireRoleAtLeast` middleware

**Highest-risk code areas:**
- `server/routes/history.ts`, `server/routes/visits.ts`, `server/routes/geo.ts`, `server/routes/bd-matcher.ts`, `server/routes/travel-times.ts`, `server/routes/schedule.ts`, `server/routes/debug.ts` — all lack `requireAuth`; see Elevation of Privilege
- `server/features/people-planner/automation-engine.ts` — Playwright credential usage, `/tmp` session file, screenshot capture
- `server/features/imports/pipeline-utils.ts` + `server/features/capacity/capacity-processor.ts` — Excel parsing and processing pipeline; malformed uploads could cause DoS
- `server/routes/process.ts` — file upload endpoint; correctly auth-gated but handles raw Base64 blobs

**Public vs authenticated vs admin surfaces:**
- Public (intended): login, health, robots.txt
- Public (unintended): history, visits, geo, bd-matcher, travel-times, most schedule routes, debug
- Authenticated: PP automation, process upload
- Admin: user management, audit logs, PP config

**Dev-only / ignore unless proven reachable:**
- `/api/auth/bootstrap-admin` — 404 in production
- `/api/auth/reset-admin-password` — not registered in production

---

## Threat Categories

### Spoofing

Users authenticate with email + bcrypt (12 salt rounds) password. Sessions are stored in PostgreSQL with 30-minute rolling expiry and `httpOnly`/`secure`/`sameSite: lax` cookies. Login and logout events are written to `audit_logs`.

The bootstrap admin endpoint returns 404 in production. The reset-admin-password endpoint is not registered in production at all.

**Required guarantees:**
- All API endpoints that read or modify branch data MUST require a valid session.
- Session tokens MUST NOT be accessible to client-side JavaScript.
- The bootstrap endpoint MUST return 404 in production.
- `SESSION_SECRET` MUST be a cryptographically random value set in environment variables; the dev fallback MUST NOT be used in production.

---

### Tampering

Request bodies on protected routes are validated with Zod schemas before any database operation. Role checks (`requireRoleAtLeast`) are enforced server-side on the upload and schedule generation routes.

**Branch-level isolation gap:** `requireAuth` verifies a user is authenticated, but no middleware verifies that the requesting user belongs to the branch identified in the request body. A scheduler assigned to Branch A can currently read history, visits, and run BD matching against Branch B by supplying Branch B's UUID in the request. This is a broken access control issue rather than a tampering one in the strict STRIDE sense, but the root fix (branch membership verification) belongs here.

The People Planner automation performs `clearAllVisits(branchId)` before re-inserting extracted visits. A partial extraction failure after the clear leaves the branch with no visit data until the next successful run.

**Required guarantees:**
- Branch-scoped operations MUST verify the authenticated user is assigned to the target branch.
- The PP automation pipeline MUST NOT clear existing visit data until new data is fully extracted and validated.

---

### Repudiation

An `audit_logs` table records login, logout, user creation, user updates, and data upload events with `userId`, `userEmail`, `branchId`, `action`, `detail`, and `timestamp`. No update or delete routes exist for audit logs.

Schedule generation, BD matrix queries, client enquiry creation, and PP automation runs are not currently logged to the audit trail.

**Required guarantees:**
- All sensitive mutations (upload, schedule generation, automation runs, user management changes) MUST be recorded with the acting user's ID/email and timestamp.
- Audit logs MUST be append-only and MUST NOT be modifiable by any application role including admin.

---

### Information Disclosure

**1. Unauthenticated PII endpoints (critical)**

The following routes expose employee and client PII to any caller without a session:

| Route | Data exposed |
|---|---|
| `GET /api/geographical/employees` | Employee names and home coordinates |
| `GET /api/geographical/clients` | Client names, addresses, coordinates |
| `GET /api/locations` | All employee and client locations combined |
| `GET /api/history` | Capacity analyses including employee schedules and status |
| `GET /api/history/latest` | Same, most recent week |
| `GET /api/visits/:date` | Care visit records by date |
| `GET /api/visits` | Visit list between dates |
| `POST /api/bd-matcher` | BD matrix matching returns employee free windows |

**2. People Planner session file**

`/tmp/pp-access-session.json` contains live browser session cookies for `go.accessacloud.com`. Any process on the host with `/tmp` read access can read and replay this session to access People Planner without credentials. On Replit's autoscale platform, `/tmp` is ephemeral per-container instance, which limits but does not eliminate this risk.

**3. Playwright debug screenshots**

On automation failure, a screenshot is saved to `/tmp/pp-debug-screenshots/fail-[jobId].png`. If the failure occurs during login, the screenshot may capture credential input fields or partially rendered PII from downloaded reports.

**4. Raw Excel blobs in database**

`branch_uploads` stores the complete Excel files as Base64. A broken access control flaw affecting this table would expose all employee and client PII for the branch in a single query.

**5. PII in debug logs**

Postcodes, employee names, and addresses appear in `logger.debug()` calls in the pipeline. Debug logging is not active in production by default but would expose PII if `LOG_LEVEL=debug` were set in a production environment.

**6. Processed Excel file on disk**

`capacity_dashboard.xlsx` is written to the server filesystem on every upload. The download endpoint (`GET /api/export`) is not explicitly auth-gated in `process.ts`. The file persists until the next upload overwrites it.

**Required guarantees:**
- All routes that return employee or client data MUST require a valid session.
- `/tmp/pp-access-session.json` should be treated as equivalent in sensitivity to the `ACCESS_PASSWORD` credential.
- Debug screenshots MUST NOT be stored in a location accessible beyond the current process.
- Error responses in production MUST NOT include stack traces, query text, or internal path information.
- All outbound API calls (ORS, TravelTime, OSRM) MUST use HTTPS.

---

### Denial of Service

Rate limiting is applied to all `/api` routes in production (100 req/min per IP, 10/min on upload). The in-memory rate limiter resets on server restart.

Several unauthenticated routes trigger expensive operations:

| Route | Cost |
|---|---|
| `POST /api/routing/optimize` | ORS route optimisation API call |
| `POST /api/routing/distance-matrix` | ORS matrix API call |
| `POST /api/travel-times/batch` | ORS + TravelTime API calls |
| `POST /api/schedule/auto-week` | Full VRPTW scheduling pass over all employees |
| `POST /api/geo/geocode-batch` | Batch postcodes.io calls |

Any unauthenticated caller can exhaust the `ORS_API_KEY` quota or trigger heavy server-side computation at the rate limit ceiling (100/min).

File upload size is limited to 50 MB via Express body parser limits. ORS and OSRM requests use `AbortController` with explicit timeouts.

The PP automation pipeline reads entire Excel files into memory as `Buffer` objects before parsing with `xlsx`. For large exports, this could cause significant memory pressure or OOM crashes.

**Required guarantees:**
- All routes triggering external API calls or heavy computation MUST require a valid session.
- Upload and automation endpoints MUST enforce per-IP rate limits in production.
- External API calls MUST time out within a defined window to prevent connection exhaustion.

---

### Elevation of Privilege

**Unauthenticated routes with write/delete capability (critical)**

The following routes perform mutations without any authentication check:

| Route | Action |
|---|---|
| `POST /api/cleanup` | Deletes old historical data |
| `POST /api/cleanup/routes-visits` | Deletes all route and visit records |
| `POST /api/schedule/auto-day` | Generates and writes a daily schedule |
| `POST /api/schedule/auto-week` | Generates and writes a full week schedule |
| `POST /api/auto-schedule` | Auto-schedule alias (no auth) |
| `POST /api/weekly-schedule/save` (alias) | Some schedule save paths lack middleware |
| `POST /api/admin/re-geocode-clients` | Triggers geocoding sweep (registered in `debug.ts` under `/api/admin/` prefix but with no `requireRole('admin')` check) |
| `POST /api/geo/geocode-batch` | Batch geocoding with user-supplied postcodes |
| `POST /api/routing/optimize` | Route optimisation |
| `POST /api/bd-matcher` | BD matrix matching |

Any unauthenticated caller can delete all route and visit data for any branch, overwrite schedule data, or trigger expensive external API calls.

**SQL injection**

All database access uses Drizzle ORM with parameterised queries. No raw string-concatenated SQL identified.

**Bootstrap and reset endpoints**

`/api/auth/bootstrap-admin` returns 404 in production. `/api/auth/reset-admin-password` is not registered in production.

**Role hierarchy**

admin (3) > scheduler (2) > viewer (1). Enforced server-side by `requireRole` and `requireRoleAtLeast` on routes that apply these guards. The gap is that most routes do not apply any guard at all.

**Required guarantees:**
- EVERY route under `/api/` MUST apply `requireAuth` as a baseline minimum, with the sole exceptions of `/api/auth/login`, `/api/auth/me`, and `/api/branches`.
- Delete and cleanup endpoints MUST additionally require `requireRoleAtLeast('admin')`.
- The `/api/admin/re-geocode-clients` endpoint MUST be moved out of `debug.ts` and MUST require `requireRole('admin')`.
- Role checks MUST NOT be applied only on the frontend.

---

## GDPR / UK GDPR Obligations

| Obligation | Status | Notes |
|---|---|---|
| **Lawful basis** | ⚠️ Document required | Likely Article 6(1)(b) for employee scheduling, 6(1)(f) for routing. Must be in a Privacy Notice and ROPA. |
| **Data processor agreements** | ⚠️ Action required | ORS and TravelTime API receive geocoded coordinates — DPAs required for both. OSRM (public, no DPA possible) should be risk-assessed or replaced. |
| **Data minimisation** | ✅ Partial | Only coordinate pairs sent to routing APIs — no names or postcodes. |
| **Storage limitation** | ⚠️ No retention policy | Raw Excel uploads and processed analytics persist indefinitely. A retention policy and automated purge mechanism are needed. |
| **Security of processing (Art. 32)** | ⚠️ Partial | bcrypt passwords, HTTPS in production, httpOnly cookies, HSTS, audit logging — but unauthenticated PII endpoints undermine security of processing. |
| **Breach notification** | ⚠️ Procedure required | Business must have ICO breach notification process (72-hour window). |
| **DSAR (Art. 15–17)** | ⚠️ Manual process | No in-app DSAR tooling. Handled manually by database extraction. |
| **Privacy notice / cookie consent** | ⚠️ Required | Privacy policy page and cookie notice not yet implemented. |

---

## Open Findings Summary

| Finding | Severity | Location |
|---|---|---|
| PII endpoints unauthenticated (`/api/geographical/*`, `/api/locations`, `/api/visits/*`, `/api/history*`) | **Critical** | `server/routes/geo.ts`, `server/routes/visits.ts`, `server/routes/history.ts` |
| Data deletion without auth (`POST /api/cleanup*`) | **Critical** | `server/routes/history.ts` |
| Schedule write without auth (`POST /api/schedule/*`, `/api/auto-schedule`) | **High** | `server/routes/schedule.ts` |
| BD matrix returns employee free windows without auth | **High** | `server/routes/bd-matcher.ts` |
| External API quota exhaustion via unauthenticated routing endpoints | **High** | `server/routes/geo.ts`, `server/routes/travel-times.ts` |
| `/api/admin/re-geocode-clients` lacks `requireRole('admin')` | **High** | `server/routes/debug.ts` |
| PP session file at `/tmp/pp-access-session.json` — active browser session in plaintext | **Medium** | `server/features/people-planner/automation-engine.ts` |
| Playwright debug screenshots may capture PII | **Medium** | `server/features/people-planner/automation-engine.ts` |
| PP automation clears visit data before confirming successful extraction | **Medium** | `server/features/people-planner/automation-routes.ts` |
| `GET /api/export` (Excel download) — auth not confirmed in route file | **Medium** | `server/routes/process.ts` |
| No DPA with ORS, TravelTime API (both receive geocoded coordinates) | **Medium** | Business/legal |
| Branch-level isolation not enforced — authenticated users can access any branch | **Medium** | All branch-scoped routes |
| Raw Excel blobs stored in database indefinitely — no retention policy | **Low** | `branch_uploads` table |
| PII in debug logs (postcodes, names) | **Low** | Pipeline utils; not active at production log level |

**Previously fixed (from prior audit):**
- ✅ OSRM URL changed from `http://` to `https://`
- ✅ Bootstrap endpoint returns 404 in production
- ✅ Reset-admin-password endpoint not registered in production
