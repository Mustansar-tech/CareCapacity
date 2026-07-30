# Record of Processing Activities (ROPA)
## Care Capacity Dashboard — SUR Group (Home Instead Scottish Group)

| Field | Detail |
|---|---|
| **Controller** | SUR Group, 18 Seaward Place, Kinning Park, Glasgow G41 1HH |
| **Data Protection Contact** | Mustansar Hussain — mustansar.hussain@sg.homeinstead.co.uk |
| **Document** | Record of Processing Activities under Article 30 UK GDPR |
| **Prepared by** | Mustansar Hussain, Digital & Technology Team |
| **Date** | 30 July 2026 |
| **Review cycle** | Annually, or on any new processing activity, new sub-processor, or new data category |

## Why This ROPA Is Mandatory

A ROPA is required under Article 30 UK GDPR regardless of headcount whenever an organisation processes special category data. Care Capacity processes:
- Health-adjacent client care data (Article 9(2)(h))
- Onboarding/safeguarding milestone data for care workers (PVG scheme membership status)

This alone triggers the Article 30(5) exception to the "under 250 employees" small-organisation carve-out. A ROPA is therefore mandatory, independent of SUR Group's total headcount.

---

## Processing Activity 1 — Platform Account Management

| Field | Detail |
|---|---|
| **Purpose** | Authenticate and authorise internal users of the Care Capacity dashboard |
| **Categories of data subjects** | Internal staff (schedulers, administrators) |
| **Categories of personal data** | Email, hashed password, display name, role, branch assignment, legal consent version/timestamp |
| **Lawful basis** | Art 6(1)(f) — legitimate interest in secure, role-controlled system access |
| **Recipients** | Supabase (auth), Neon (database hosting) |
| **International transfers** | Supabase/Neon — see Section 7 of the Privacy Policy for safeguards |
| **Retention** | Duration of active account + 12 months after deletion |
| **Security measures** | bcrypt password hashing, RBAC (admin/scheduler/viewer), httpOnly/sameSite session cookies, audit logging of admin actions |

## Processing Activity 2 — Workforce Capacity Analysis (Employee Data)

| Field | Detail |
|---|---|
| **Purpose** | Identify understaffed branches; joiner/leaver and onboarding milestone tracking |
| **Categories of data subjects** | Care workers (employees) |
| **Categories of personal data** | Full name, home postcode, gender, transport mode, contracted/available hours, employment status, onboarding milestone stage (including PVG scheme-membership checkpoint) |
| **Special category / criminal-offence data** | PVG milestone status is a safeguarding checkpoint (cleared/not cleared marker only — no disclosure reference numbers or conviction detail is stored in Care Capacity) |
| **Lawful basis** | Art 6(1)(b) employment contract; Art 6(1)(c) legal obligation (safer recruitment) for the PVG milestone specifically |
| **Recipients** | Neon (database), postcodes.io / OpenRouteService / TravelTime (postcode-derived coordinates only, no names) |
| **International transfers** | OpenRouteService (Germany, EU); TravelTime (UK, none) |
| **Retention** | Duration of active branch relationship + 90 days |
| **Security measures** | Branch-scoped queries (no cross-branch access), RBAC, parameterised queries (Drizzle ORM) |

## Processing Activity 3 — Client / Service-User Scheduling Data

| Field | Detail |
|---|---|
| **Purpose** | Route optimisation and visit scheduling for care delivery |
| **Categories of data subjects** | Clients / service users (elderly and vulnerable adults) |
| **Categories of personal data** | Full name, address, postcode, geocoded coordinates, visit schedule (times, durations, service type), cancellation records |
| **Special category data** | Care visit/service-type descriptions are health-adjacent (Article 9(2)(h) — provision of health and social care) |
| **Lawful basis** | Art 6(1)(b)/(c) performance of care contract; Art 9(2)(h) for care-need-derived data |
| **Recipients** | Neon (database), postcodes.io / OpenRouteService / TravelTime (coordinates only) |
| **International transfers** | Same as Activity 2 |
| **Retention** | Duration of active branch relationship + 90 days |
| **Security measures** | Branch-scoped queries, RBAC, encryption in transit (TLS) and at rest |

## Processing Activity 4 — Data Ingestion from Access People Planner

| Field | Detail |
|---|---|
| **Purpose** | Import employee and client scheduling source data from the HR/scheduling system of record |
| **Categories of data subjects** | Care workers, clients |
| **Categories of personal data** | As per Activities 2 and 3, sourced from People Planner exports |
| **Method** | Automated Playwright browser-session report downloads, and/or manual Excel file upload by authorised schedulers |
| **Lawful basis** | Art 6(1)(b)/(c); Art 9(2)(h) for care-need data — SUR Group and Access UK Ltd act as independent controllers over their respective systems (controller-to-controller, not a processor relationship) |
| **Recipients** | Access UK Ltd (source system, independent controller) |
| **International transfers** | None (Access UK Ltd is UK-based) |
| **Retention** | Automation session credentials and intermediate files are not persisted; imported records follow Activity 2/3 retention |
| **Security measures** | Automation credentials held as environment secrets, never in source code; branch_uploads table stores only the latest file per branch/type with SHA-256 integrity check |

## Processing Activity 5 — Audit Logging & Security Monitoring

| Field | Detail |
|---|---|
| **Purpose** | Accountability, breach investigation, and platform reliability |
| **Categories of data subjects** | Internal staff |
| **Categories of personal data** | User ID, email, action type, free-text detail, timestamp, IP/browser metadata (via Sentry) |
| **Lawful basis** | Art 6(1)(f) legitimate interest in security and accountability |
| **Recipients** | Sentry (error tracking), Resend (transactional email) |
| **International transfers** | Sentry (US), Resend (US) — SCCs per Section 7 of the Privacy Policy |
| **Retention** | Audit logs: 12 months. Sentry error data: 90 days. Resend delivery logs: 30 days |
| **Security measures** | Append-only audit log table, access restricted to admin role |

## Processing Activity 6 — Data Subject Access Request Handling

| Field | Detail |
|---|---|
| **Purpose** | Fulfil Article 15/20 access and portability requests within the statutory one-month deadline |
| **Categories of data subjects** | Any data subject named in Care Capacity's records (staff, care workers, clients who raise a request) |
| **Categories of personal data** | Request metadata (name, email, request type, dates, status, notes); on export, whatever personal data the request resolves to across Activities 1–3 |
| **Lawful basis** | Art 6(1)(c) — legal obligation to respond to data subject rights requests |
| **Recipients** | None external — admin-only, in-app tool |
| **International transfers** | None |
| **Retention** | Request log retained 3 years (evidences compliance with the one-month deadline; standard ICO-recommended practice) |
| **Security measures** | Admin-role restricted; export strips password hashes and internal auth tokens; erasure/rectification are not automated by this tool — see DSAR procedure |

---

## Sub-Processor Summary (cross-reference)

See `docs/DPIA-Care-Capacity.md` Step 2 and the in-app Privacy Policy (`client/src/pages/privacy-policy.tsx`, Section 6) for the full sub-processor table (Access UK Ltd, Care Copilot Ltd, Neon, Sentry, Resend, OpenRouteService, TravelTime, postcodes.io, Replit).

## What This Document Does Not Cover

This ROPA records processing activities as understood from the current codebase and the existing Privacy Policy as at 30 July 2026. It does not itself confirm that Article 28 processor terms are in place with every sub-processor listed — that confirmation requires a human with contracting authority (see the open actions in `docs/DPIA-Care-Capacity.md`).
