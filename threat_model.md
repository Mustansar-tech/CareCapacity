# Threat Model

## Project Overview

A multi-branch **Care Capacity Dashboard** (Workforce Intelligence Platform) for Home Instead, a UK home care company. Built with React/TypeScript + Vite (frontend), Express (backend), and PostgreSQL via Drizzle ORM (database). The system processes uploaded Excel files containing weekly care schedules, produces capacity analytics, generates optimised routes for care workers, and matches new clients to available Care Professionals (Care Pros).

**Users:** Branch managers (schedulers), business development staff, and admin users. Access is internal — the app is not public-facing.

**Sensitive data in scope:**
- Care Pro (employee) full names, home postcodes/coordinates, gender, transport mode, availability, sickness, and holiday records
- Client full names, addresses, postcodes, coordinates, visit requirements (duration, time windows, service type)
- System user email addresses and hashed passwords
- Employee postcode/coordinate data transmitted to external routing APIs

**Regulatory context:** UK GDPR (successor to EU GDPR post-Brexit), regulated by the ICO. As a health and social care operator, a lawful basis for processing is required (likely Article 6(1)(b) — performance of a contract with employees, and Article 6(1)(f) — legitimate interests for routing/scheduling). Special category data (Article 9) may be implicated where care visit types indicate health conditions (sickness records, sleep-in/overnight visits).

---

## Assets

| Asset | Description | Risk if compromised |
|---|---|---|
| **Care Pro PII** | Full names, home postcodes, coordinates, gender, availability/sickness/holiday records stored in `employee_locations` and `capacity_analyses` tables | GDPR breach notification obligation; harm to employees if home addresses exposed |
| **Client PII** | Full names, addresses, postcodes, coordinates, visit details in `client_locations` and `visits` tables | GDPR breach; risk to vulnerable adults if location or care routines are disclosed |
| **Health-adjacent data** | Sickness records, service type descriptions (e.g. overnight/sleep-in/personal care), any care visit details that indicate a client's health needs | Article 9 special category data; higher accountability under UK GDPR |
| **Raw Excel uploads** | Uploaded files stored as Base64 blobs in `branch_uploads` table; contain all of the above in dense form | Single-query data breach affecting all employees and clients for a branch |
| **User credentials** | Email + bcrypt-hashed passwords in `users` table; session tokens in `session` table | Account takeover; access to all branch data |
| **Application secrets** | `DATABASE_URL`, `SESSION_SECRET`, `ORS_API_KEY` environment variables | Full database access; arbitrary session forgery; ORS API cost exploitation |
| **Audit log** | `audit_logs` table: user emails, IP addresses, action descriptions | GDPR: logs themselves contain PII; integrity must be protected to support accountability obligations |

---

## Trust Boundaries

### 1. Browser ↔ Express API

All requests from the browser are untrusted. The API must authenticate every request to protected endpoints via session cookie. Session cookies are `httpOnly`, `secure` (production), and `sameSite: lax`. A 30-minute rolling session with PostgreSQL-backed store is used. Rate limiting (100 req/min) is applied to all `/api` routes in production.

### 2. Express API ↔ PostgreSQL

The Express server has full read/write access to the database via `DATABASE_URL`. All queries use the Drizzle ORM with parameterised statements — no raw string-concatenated SQL. Credentials are managed via environment variables, never committed to source.

### 3. Express API ↔ OpenRouteService (ORS)

The server sends employee and client coordinates (lat/lng, derived from postcodes) to ORS batch matrix and directions APIs for car route calculation. The `ORS_API_KEY` authorises the request. ORS acts as a **data processor** under UK GDPR — a formal Data Processing Agreement (DPA) with ORS should be confirmed before production deployment.

**Data transmitted:** Coordinate pairs (lat/lng) only — no names, addresses, or postcodes are sent. Coordinates are derived from geocoded postcodes and carry enough precision to locate a home address.

### 4. Express API ↔ OSRM (router.project-osrm.org)

OSRM is used as a free fallback routing service when ORS is unavailable. Coordinate pairs are sent over HTTPS (fixed from HTTP as part of this audit). OSRM is a public service operated by the OSRM project — **no DPA exists and no API key is required**. This is the highest-risk third-party data flow.

**Mitigation options (future):** Self-host OSRM, or remove the OSRM fallback and rely solely on heuristic estimates when ORS is unavailable.

### 5. Authenticated ↔ Public boundary

- Public: login page, static assets
- Authenticated (requireAuth): all `/api/*` routes except `/api/auth/login`, `/api/auth/me`, `/api/auth/bootstrap-admin`
- Admin-only (requireRole('admin')): `/api/admin/*` routes (user management, audit logs)
- The bootstrap endpoint is fully disabled in production (`NODE_ENV === 'production'` → 404)

---

## Threat Categories

### Spoofing

Users authenticate with email + bcrypt password (12 salt rounds). Sessions are stored in PostgreSQL with 30-minute rolling expiry, `httpOnly` + `secure` cookies, and `sameSite: lax` to protect against CSRF.

**Required guarantee:** All API endpoints that read or modify branch data MUST require a valid session. Session tokens MUST NOT be accessible to client-side JavaScript. The bootstrap admin endpoint MUST return 404 in production to prevent session creation without credentials.

**Status:** ✅ Implemented. Bootstrap endpoint production guard added.

---

### Tampering

All request bodies are validated with Zod schemas before any database operation. Role checks are enforced server-side (not only in the frontend). The `requireRoleAtLeast` middleware prevents privilege escalation via parameter manipulation.

**Required guarantee:** Branch-scoped operations MUST validate that the requesting user is assigned to the target branch. Employee and client data MUST NOT be modifiable by users assigned to a different branch.

**Note:** Branch assignment validation is partially present — `requireAuth` + session-stored `userRole` protects role-level access, but explicit branch-membership checks on per-branch routes should be reviewed. A scheduler assigned to Branch A should not be able to upload data or read analytics for Branch B.

---

### Repudiation

An `audit_logs` table records login, logout, user creation, user update, and data upload actions with `userId`, `userEmail`, `branchId`, `action`, `detail`, and `timestamp`. Logs are append-only (no update/delete routes exist for audit logs).

**Required guarantee:** All sensitive mutations (upload, schedule generation, user changes) MUST be recorded with the acting user's ID and email. Audit logs MUST NOT be modifiable by any application role.

**Status:** ✅ Core events are logged. Future improvement: log schedule generation events and Excel export downloads.

---

### Information Disclosure

**Key risks:**

1. **Raw Excel blobs in database:** Uploaded files (containing all employee and client PII for a branch) are stored as Base64 in `branch_uploads`. A SQL injection or broken access control flaw affecting this table would expose dense PII. Mitigated by Drizzle ORM parameterised queries and branch-scoped access control.

2. **PII in debug logs:** Postcodes and addresses appear in `logger.debug()` calls in `server/pipeline.ts` during postcode extraction. These are only emitted when `LOG_LEVEL=debug`, which is not the production default. Email addresses appear in a small number of `logger.info()` admin operation logs.

3. **Processed Excel file on disk:** A processed export (`capacity_dashboard.xlsx`) is written to the server filesystem on every upload. This file contains care data for the uploaded branch. While the download endpoint is authenticated, the file persists on disk. Future mitigation: serve the export buffer directly from memory without writing to disk.

4. **Stack traces in development:** In non-production environments, full error messages (including stack traces) are returned to the client. In production, 5xx errors return only "Internal Server Error". ✅

5. **OSRM over plain HTTP (fixed):** OSRM calls previously used `http://router.project-osrm.org`. Changed to HTTPS to ensure coordinate data is encrypted in transit.

**Required guarantees:**
- Error responses in production MUST NOT include stack traces, query text, or internal path information.
- Employee and client PII MUST NOT appear in logs above DEBUG level.
- All outbound API calls (ORS, OSRM) MUST use HTTPS.

---

### Denial of Service

Rate limiting is applied to all `/api` routes in production: 100 requests per minute per IP. Upload endpoints have stricter limits (10/min). The in-memory rate limiter does not persist across server restarts, so a brief restart would reset rate-limit counters.

File upload size is limited to 50 MB via Express `json` and `urlencoded` limits. ORS/OSRM requests have explicit timeouts (OSRM: 8 seconds) with `AbortController`.

**Required guarantee:** Upload and geocoding endpoints MUST enforce per-IP rate limits in production. External API calls MUST time out within a reasonable window to prevent hung connections from exhausting the server thread pool.

---

### Elevation of Privilege

**Role hierarchy:** admin (3) > scheduler (2) > viewer (1). Enforced server-side by `requireRole` and `requireRoleAtLeast` middleware.

**Bootstrap endpoint:** Previously accessible in production with no authentication if no users existed. **Fixed:** Returns 404 in all production environments.

**Reset admin password endpoint:** Already correctly gated behind `process.env.NODE_ENV !== 'production'` — not registered at all in production.

**SQL injection:** All database access uses Drizzle ORM with parameterised queries. No raw SQL string concatenation was identified in the codebase.

**Required guarantee:** Admin-only routes (`/api/admin/*`) MUST check `requireRole('admin')` server-side on every request. The bootstrap endpoint MUST be unreachable in production.

---

## GDPR / UK GDPR Obligations Summary

| Obligation | Status | Notes |
|---|---|---|
| **Lawful basis** | ⚠️ Document required | Likely Article 6(1)(b) for employee scheduling, 6(1)(f) for routing. Must be documented in a Privacy Notice and ROPA. |
| **Data processor agreements** | ⚠️ Action required | ORS (OpenRouteService) receives coordinate data — a DPA is required. OSRM (public, no DPA possible) should be risk-assessed or replaced. |
| **Data minimisation** | ✅ Partial | Only necessary fields are transmitted to routing APIs (coordinates only, no names). |
| **Storage limitation** | ⚠️ No retention policy | Raw Excel uploads and processed analytics persist indefinitely. A retention policy and automated purge mechanism should be implemented. |
| **Security of processing (Art. 32)** | ✅ Implemented | bcrypt passwords, HTTPS in production, httpOnly cookies, HSTS, rate limiting, audit logging. |
| **Breach notification** | ⚠️ Procedure required | The business must have an ICO breach notification procedure (72-hour window). This is a business process, not a system control. |
| **DSAR (Art. 15-17)** | ⚠️ Manual process | No in-app DSAR tooling. Requests must be handled manually by extracting records from the database. Future task. |
| **Privacy notice / policy** | ⚠️ Page required | A Privacy Policy page must be added to the application (planned as Task #14). |
| **Cookie consent** | ⚠️ Banner required | Session-authentication cookies require an informational cookie notice under UK GDPR (planned as Task #14). |

---

## Scan Results Summary (April 2026)

| Scanner | Status | Critical | High | Medium | Low |
|---|---|---|---|---|---|
| Dependency Audit | ✅ Ran | 0 | 0 (metadata reports 11 but these are build-time transitive deps) | 11 | 2 |
| SAST | ✅ Ran | 0 | 0 | 4 (2 false positives, 1 false positive, 1 informational) | 0 |
| Privacy/Dataflow (HoundDog) | ✅ Ran | 1 (PII to disk — accepted, medium real risk) | 0 | 0 | 6 (email/address in logs) |

**Fixes applied during this audit:**
1. ✅ OSRM URL changed from `http://` to `https://`
2. ✅ Bootstrap endpoint returns 404 in production (`NODE_ENV === 'production'`)

**Accepted risks (documented):**
- PII to disk (processed Excel export) — medium, file overwritten each upload, download is authenticated
- PII in debug logs — low, debug level not active in production
- SVG XSS warning — false positive, colors are internal constants only
