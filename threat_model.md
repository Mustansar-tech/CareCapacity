# Threat Model

## Project Overview

This repository is a multi-branch Care Capacity Dashboard for Home Instead UK. It uses a React + Vite frontend, an Express backend, PostgreSQL via Drizzle ORM, and a Playwright-based People Planner automation layer.

The application ingests branch-specific Excel exports, computes capacity and scheduling data, stores branch analytics in PostgreSQL, and exposes operational workflows such as capacity processing, weekly scheduling, travel-time estimation, BD matching, and automated People Planner exports.

Production assumptions for this threat model:
- `NODE_ENV=production`
- TLS is terminated by the deployment platform
- The mockup sandbox is not deployed to production

## Assets

- **Branch-isolated operational data** — capacity analyses, schedules, visits, client enquiries, route plans, and branch uploads. Cross-branch disclosure or tampering breaks the core tenancy boundary.
- **Employee and client PII** — names, addresses, postcodes, coordinates, schedules, availability, and care-related metadata.
- **Authentication state** — session cookies, PostgreSQL-backed session records, user emails, bcrypt password hashes, and role assignments.
- **People Planner access** — `ACCESS_EMAIL`, `ACCESS_PASSWORD`, downloaded People Planner workbooks, and any persisted browser session state.
- **Third-party API quota and cost controls** — ORS, TravelTime, and geocoding usage can be turned into an availability or spend problem if low-privilege users can invoke them freely.
- **Auditability of sensitive actions** — uploads, schedule generation, administrative actions, and cross-branch mutations must be attributable.

## Trust Boundaries

### Browser ↔ Express API

All client input is untrusted. In production, the backend uses session cookies with `httpOnly`, `secure`, and `sameSite: lax`, backed by PostgreSQL session storage in `server/index.ts`.

`server/app.ts` applies a global `/api` authentication guard via `globalAuthGuard`. The important production exceptions are:
- public: `/api/auth/*`, `/api/branches`, `/health`, `/robots.txt`
- authenticated-by-default: nearly all other `/api/*` routes

Future scans should not spend time re-proving a global unauthenticated `/api` exposure unless `server/app.ts` changes.

### Authenticated User ↔ Role Boundary

The app has a three-level role model in `server/features/auth/auth.ts`:
- `viewer`
- `scheduler`
- `admin`

This boundary matters because the product intentionally treats scheduling, uploads, automation runs, and operational API usage as higher-privilege actions than read-only viewing. Frontend role checks exist, but they are not security controls; only server-side `requireRole` / `requireRoleAtLeast` enforcement counts.

### Authenticated User ↔ Branch Boundary

Branch isolation is the primary multi-tenant boundary. `server/utils/helpers.ts::resolveBranch()` is the authoritative helper: it validates the requested branch exists and, for non-admin users, confirms the user is assigned to that branch.

Any branch-scoped route that accepts `branchId` but does not call `resolveBranch()` or an equivalent membership check is a priority review target.

### Express API ↔ PostgreSQL

The server has broad read/write access to PostgreSQL. Drizzle ORM is used for most queries. The direct Drizzle advisory in the dependency audit only becomes exploitable if untrusted input reaches identifier-building APIs such as `sql.identifier()` or dynamic aliases; that usage was not found in the current code.

### Express API ↔ External Services

The backend sends data to several third parties:
- **People Planner / Access** via Playwright automation
- **OpenRouteService** for distance matrices and routing
- **TravelTime** for travel-time estimation
- **postcodes.io** for postcode geocoding

These calls cross both confidentiality and availability boundaries. Some carry sensitive branch operational data; others expose the app to quota exhaustion or cost abuse.

### Production ↔ Dev / Build Surface

Vite, Rollup, esbuild, and other build-time tooling should be treated as out of scope for production unless there is evidence they are reachable from the deployed runtime. Future scans should prioritize server entry points over frontend build-chain CVEs unless deployment architecture changes.

## Scan Anchors

- **Primary production entry points**: `server/index.ts`, `server/app.ts`, `server/routes/*.ts`, `server/features/people-planner/automation-routes.ts`
- **Auth and authorization logic**: `server/features/auth/auth.ts`, `server/utils/helpers.ts`
- **Highest-risk code areas**:
  - `server/routes/process.ts` + `server/controllers/process.controller.ts`
  - `server/features/people-planner/automation-routes.ts`
  - `server/routes/state.ts`
  - `server/controllers/enquiry.controller.ts`
  - `server/routes/schedule.ts`, `server/routes/geo.ts`, `server/routes/travel-times.ts`
- **Public surfaces**: `/api/auth/*`, `/api/branches`, `/health`, `/robots.txt`
- **Authenticated but not automatically well-authorized**: any `/api/*` route that relies only on the global auth guard
- **Usually ignore unless changed**: Vite/build tooling CVEs, frontend-only UI gating, scanner-only path-traversal hits in People Planner temp-file paths that are not reachable from HTTP

## Threat Categories

### Spoofing

Users authenticate with email/password and PostgreSQL-backed server sessions. The main spoofing risks are weak session handling, missing auth checks on protected routes, or accidental production exposure of bootstrap/recovery behavior.

Current posture is materially better than the prior model: `/api` is authenticated by default. The main guarantees are:
- All non-public API routes MUST continue to require a valid server session.
- Session cookies MUST remain `httpOnly` and `secure` in production.
- Dev-only bootstrap or password-recovery flows MUST stay unreachable in production.

### Tampering

The most important tampering risk is unauthorized modification of another branch's data. This app allows uploads, schedule generation, route-plan writes, visit replacement, and enquiry deletion, so branch ownership and role enforcement matter as much as raw input validation.

Current scan anchors show two recurring failure modes:
- routes that accept `branchId` directly instead of using `resolveBranch()`
- mutation endpoints that rely on authentication alone when the product model expects scheduler/admin authority

Required guarantees:
- Every branch-scoped mutation MUST bind the action to the caller's authorized branch set.
- Destructive or workflow-changing operations MUST require the intended minimum role server-side.
- Deletion and overwrite paths MUST verify object ownership, not just object existence.

### Repudiation

The app records some auth and admin events, but several sensitive operational actions are still more weakly attributable than they should be.

Required guarantees:
- Uploads, People Planner runs, schedule-generation actions, destructive cleanup, and cross-branch-sensitive workflows MUST be logged with acting user, branch, and timestamp.
- Audit records for administrative and destructive actions MUST be append-only from the app's perspective.

### Information Disclosure

This system stores and generates highly sensitive branch workbooks and scheduling data. The main disclosure risks are not broad public endpoints anymore; they are object-level and tenant-level failures inside the authenticated surface.

The most important confidentiality guarantees are:
- Exported workbooks and generated artifacts MUST be bound to the requesting user or branch, not shared through process-global state.
- Branch-scoped reads and downloads MUST verify branch membership or object ownership.
- Temporary People Planner artifacts on disk should be treated as sensitive local secrets, but future scans should only report them as production vulnerabilities when there is an actual remote exposure path.
- PII must not be logged at production levels. The current logger disables `debug()` output entirely, which materially reduces risk from HoundDog's low-signal debug-log findings.

### Denial of Service

Several production routes perform expensive computation, multipart parsing, or third-party API calls. The global rate limiter in `server/index.ts` applies only an in-memory `100 req/min per IP per path` limit. More specific `uploadLimiter` and `geocodingLimiter` helpers exist but are not currently attached to routes.

This matters because:
- scheduling endpoints can trigger heavy route-planning work
- travel-time and routing endpoints can proxy ORS and TravelTime usage
- the upload path uses `multer` on a live production route

Required guarantees:
- Expensive operational endpoints MUST require the intended minimum role, not just authentication.
- Upload routes MUST use patched multipart dependencies and route-specific throttling.
- Third-party API proxy endpoints MUST be rate-limited and limited to the intended staff roles.
- Availability controls should not rely solely on an in-memory limiter that resets on restart.

### Elevation of Privilege

The dominant privilege risk in this codebase is broken authorization inside the authenticated surface:
- branch-membership bypass when routes skip `resolveBranch()`
- viewer-to-scheduler escalation where operational endpoints lack `requireRoleAtLeast('scheduler')`
- object-level authorization failures where record deletion or downloads are keyed only by ID or shared global state

Required guarantees:
- Authentication alone is not sufficient for branch-scoped or operational routes.
- Viewer accounts MUST remain effectively read-only where the product model says generation, routing, uploads, or scheduling are scheduler/admin actions.
- Every object download or deletion endpoint MUST enforce ownership or branch scope.
- Client-side role restrictions MUST always be mirrored by backend authorization.

## Notes for Future Scans

- The earlier claim that most `/api` routes are unauthenticated is outdated and should not be reused unless `server/app.ts` changes.
- The current high-value review path is: start at route registration, identify routes that accept `branchId` or trigger external work, then verify both `requireRoleAtLeast(...)` and `resolveBranch()` coverage.
- The direct Drizzle advisory is currently not a strong production finding because the codebase does not appear to pass untrusted input into Drizzle identifier-construction APIs.
- Build-tool advisories affecting Vite/Rollup/esbuild are usually dev/build-only here unless deployment architecture changes.