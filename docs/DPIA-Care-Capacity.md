# Data Protection Impact Assessment (DPIA)
## Care Capacity — Workforce Intelligence Platform
### Home Instead Scottish Group (SUR Group)

---

| Field | Detail |
|---|---|
| **Data Controller** | Home Instead Scottish Group (SUR Group) |
| **Data Protection / Privacy Lead** | Mustansar Hussain, Digital & Technology Team |
| **Project / System** | Care Capacity — Workforce Intelligence Platform |
| **Version** | 1.0 (Draft) |
| **Date of DPIA** | July 2026 |
| **Review Date** | July 2027 |
| **Prepared by** | Mustansar Hussain, Digital & Technology Lead |
| **Status** | Draft — Awaiting CEO / DPO Sign-Off |

---

## Why a DPIA Is Mandatory Here

Care Capacity systematically processes:

1. **Criminal records / disclosure data** — PVG (Protecting Vulnerable Groups) scheme membership status and reference check outcomes for care workers. This is criminal-offence data under Article 10 UK GDPR and Schedule 1 of the DPA 2018. A DPIA is mandatory.
2. **Health-adjacent care data** — Client service-type descriptions and care-hour requirements for elderly and vulnerable service users, which are intrinsically linked to health and care needs (Article 9 UK GDPR).
3. **Location data at scale** — Home postcodes with geocoded lat/lng coordinates for both care workers and service users, processed systematically for route optimisation.
4. **Large-scale employee monitoring** — Automated ingestion of joiner/leaver milestones, working hours, pay-rate hours, and PVG status across multiple franchise branches.

DPIA is therefore mandatory under Article 35(3) UK GDPR and the ICO's list of processing likely to result in high risk.

---

## Step 1 — Identify the Need for a DPIA

### What the project aims to achieve

Care Capacity is an internal workforce intelligence platform built for Home Instead Scottish Group franchise branches. It ingests care scheduling and staffing exports from the People Planner system (Access Workspace) and provides:

- Real-time capacity dashboards (unfilled care hours vs. available caregiver hours per branch)
- Joiner / leaver tracking with milestone completion status (PVG clearance, training, references)
- Route-optimisation analysis matching caregiver home locations to service-user visit locations
- Admin broadcast communications to platform users
- Audit logging of all data import and user-management events

### Type of processing involved

- **Automated ingestion**: Playwright-based automation scrapes structured exports from People Planner and imports them into a PostgreSQL database on a scheduled basis.
- **Systematic profiling**: Employee records are enriched with geocoded coordinates; travel-time APIs compute drive/walk times between care workers and clients.
- **Dashboard analytics**: Aggregated and individual-level workforce metrics are surfaced to schedulers and administrators.
- **Retention enforcement**: A 15-week rolling window is enforced; data outside this window is hard-deleted. Stale employee/client records are purged when no longer present in People Planner exports.

### Why a DPIA was identified as necessary

Processing involves criminal-record data (PVG status), health-adjacent care data (vulnerable adult service users), systematic geolocation of individuals' home addresses, and automated import of HR records. This combination places the processing firmly within the high-risk categories listed by the ICO under Article 35 UK GDPR.

---

## Step 2 — Describe the Processing

### Nature of the processing

Data is pulled automatically from the People Planner scheduling system via a browser automation layer (Playwright). Records are normalised, geocoded (postcodes resolved to lat/lng via postcodes.io and OpenRouteService), and stored in a PostgreSQL database (Supabase). The application then serves dashboards, capacity reports, and route analyses to authenticated internal users.

Data flows:

```
People Planner (Access Workspace)
        ↓ [Playwright automation — authenticated session]
Care Capacity API (Express, Node.js — Hetzner VPS)
        ↓ [PostgreSQL / Supabase]
        ↓ [postcodes.io / OpenRouteService — postcode → lat/lng]
        ↓ [TravelTime API — travel-time matrix]
Care Capacity Frontend (React — Vercel CDN)
        ↓ [Microsoft Azure AD — SSO for internal users]
        ↓ [Resend — transactional email]
```

### Scope of the processing

| Dimension | Detail |
|---|---|
| **Nature of data** | Employee identifiers, location, employment status, PVG/disclosure status, reference status, working hours, pay-rate hours. Client identifiers, home address, care schedule, service type. Platform user email/name/role/session. |
| **Special category / criminal-offence data** | **YES** — PVG scheme membership status (criminal-offence data, Article 10 UK GDPR / DPA 2018 Sch 1). Client care-type descriptions (health-adjacent, Article 9(2)(h)). |
| **Volume** | Hundreds of care workers and clients across multiple Scottish franchise branches. Import runs at least weekly. |
| **Frequency** | Weekly automated imports; ad-hoc manual imports by schedulers. |
| **Retention** | 15-week rolling window for capacity data (hard-delete enforced). Platform user accounts retained for duration of employment + reasonable offboarding period (no current explicit policy — **GAP identified**). |
| **Individuals affected** | Care workers (employees), service users (elderly / vulnerable adults), internal scheduler and admin staff. |
| **Geography** | Scotland (UK). All processing within UK/EU — no confirmed international transfer. Supabase EU region to be confirmed with vendor. |

### Context of the processing

| Factor | Assessment |
|---|---|
| **Relationship with individuals** | Employer–employee (care workers); service provider–service user (clients). Individuals are not directly users of Care Capacity — it is an internal tool. |
| **Individual control** | Low. Care workers and clients have no direct interface with or visibility of Care Capacity. Data is imported from People Planner without a separate consent or notice flow within Care Capacity itself. |
| **Reasonable expectation** | Partially. Employees would reasonably expect HR data to be used for scheduling. However, automated route-optimisation analysis of their home postcode may exceed typical expectation. Clients may not be aware their data is ingested into a secondary analytics platform. |
| **Vulnerable groups** | YES — service users are elderly and/or vulnerable adults. Some care workers may also fall within vulnerable categories. |
| **Prior concerns** | None identified at this stage. |
| **Novelty** | Automated browser-scraping of an HR/scheduling system as a data ingestion pipeline is an unusual architecture that creates additional risk (session credentials, scrape fidelity, no formal API/DPA with Access). |
| **Technology** | Standard Node.js/PostgreSQL stack. Playwright automation is a non-standard ingestion method. |

### Purposes of the processing

| Purpose | Intended effect | Benefit |
|---|---|---|
| Capacity planning | Identify understaffed branches before care visits are missed | Prevents care failures; improves operational decision-making |
| Joiner/leaver tracking | Flag incomplete onboarding (PVG pending, training incomplete) | Prevents safeguarding risks from uncleared staff delivering care |
| Route optimisation | Reduce travel costs; improve carer–client matching | Operational efficiency; better service quality |
| Audit logging | Record all data imports and admin actions | Accountability; breach investigation capability |
| Admin communications | Broadcast platform updates to internal users | Internal change management |

### Data lifecycle

| Stage | Method |
|---|---|
| **Collection** | Automated Playwright export from People Planner; manual CSV imports |
| **Use** | Dashboard analytics, joiner/leaver reports, route matrices |
| **Storage** | PostgreSQL (Supabase) — encrypted at rest; Express sessions in pg-session store |
| **Deletion** | Hard-delete outside 15-week window; stale records purged on re-import |
| **Sharing** | Postcodes shared with postcodes.io and OpenRouteService; travel data shared with TravelTime API; user email shared with Resend; SSO via Microsoft Azure AD |

### Types of high-risk processing present

- ✅ Criminal-offence data (PVG) — Article 10 / DPA 2018
- ✅ Health-adjacent data (vulnerable adult care needs)
- ✅ Systematic geolocation of individuals
- ✅ Processing of employee data at scale by an employer
- ✅ Automated data ingestion (no direct data subject interaction)

---

## Step 3 — Consultation Process

### Individual / data subject views

Care Capacity is a purely internal operational tool. Care workers and service users do not interact with it directly. Their data originates from People Planner.

**Recommended actions (not yet taken — GAP):**
1. Amend staff contracts or privacy notices to disclose that People Planner data is also processed within Care Capacity for capacity planning and route analysis.
2. Confirm that existing client privacy notices (issued at point of care engagement) cover use of data in internal analytics platforms.
3. A brief, plain-English notice to care workers explaining what Care Capacity does with their postcode data should be issued.

### Internal stakeholders to involve

- Operations / Scheduling Team (operational owners)
- HR (employee data governance)
- Information Security (if separate from Digital & Technology)
- CEO / Director (sign-off authority under Art 35)

### External expert consultation

- Legal counsel to confirm DPA 2018 Schedule 1 conditions for PVG data processing
- Supabase — obtain and review Article 28 Data Processing Agreement (DPA)
- Access Workspace / People Planner — obtain DPA covering the automated data extraction
- Resend — obtain DPA
- TravelTime API — obtain DPA
- Microsoft Azure — review existing EA/DPA terms for Azure AD

---

## Step 4 — Assess Necessity and Proportionality

### Lawful basis

| Data category | Lawful basis |
|---|---|
| Care worker employment data (name, hours, role, employment status) | Art 6(1)(b) — performance of employment contract; Art 6(1)(f) — legitimate interests in operational management |
| Care worker PVG / reference status | Art 6(1)(c) — legal obligation (Regulation of Care Act, safer recruitment); Art 10 + DPA 2018 Sch 1 para 6 (criminal conviction data for employment/safeguarding) |
| Care worker home postcode / geocoords | Art 6(1)(f) — legitimate interests (route optimisation); **legitimate interest assessment (LIA) not yet documented — GAP** |
| Client name and address | Art 6(1)(b)/(c) — performance of care contract; Art 9(2)(h) — provision of health and social care (where care needs data is processed) |
| Platform user data (internal staff) | Art 6(1)(b) — employment contract; Art 6(1)(f) — legitimate interests in system security and audit |
| Session / audit logs | Art 6(1)(f) — legitimate interests in security and accountability |

### Does the processing achieve its purpose?

Yes. The capacity dashboard and joiner/leaver tracker directly address the operational need. Route optimisation requires geocoded home addresses; no less-intrusive alternative achieves the same fidelity.

### Is there a less intrusive way to achieve the same outcome?

- Route analysis: postcode centroids (rather than home address lat/lng) would reduce precision and privacy risk slightly while still enabling planning. Worth reviewing.
- Joiner tracking: PVG status (cleared/not cleared) is sufficient; disclosure reference numbers need not be stored in Care Capacity if they are held authoritatively in People Planner.

### Preventing function creep

- Role-based access controls (Admin / Scheduler / Viewer) limit who can see raw employee and client data.
- Data is scoped to operational branches — users can only access their assigned branch data.
- No marketing, profiling, or non-HR use of data is currently implemented.

### Data quality and minimisation

- People Planner is the master record; Care Capacity is a read-only analytics consumer. Updates originate in People Planner.
- The 15-week rolling window enforces automatic minimisation for capacity analyses.
- **GAP**: PVG reference numbers and full home addresses are imported — review whether these are necessary in Care Capacity or could remain solely in People Planner.

### Information provided to individuals

- **Current state**: No Care Capacity-specific notice has been issued to data subjects (care workers or clients). They receive their primary privacy notice at onboarding with Home Instead Scottish Group.
- **Required action**: Update staff and client privacy notices to reference Care Capacity as a secondary processing system. Add a privacy notice page within the application itself (linked from footer).

### Supporting data subject rights

- **Subject Access Requests (DSARs)**: No DSAR fulfilment tool currently exists in Care Capacity. A request for care worker or client data would require a manual data extract from the database. **This is a compliance gap** — Art 12 requires response within one month.
- **Erasure requests**: Hard-delete is technically available but no governed erasure workflow exists.
- **Rectification**: Data is mastered in People Planner; corrections must be made there and will propagate on the next import.

### Processor compliance measures

Currently informal. Formal Article 28 DPAs should be in place with:
- Supabase (database processor)
- Resend (email processor)
- Microsoft (Azure AD processor)
- TravelTime API (routing processor)
- OpenRouteService (geocoding processor)
- Access Group (People Planner — data source and potential joint controller)

### International transfers

| Processor | Location | Adequacy / Safeguard |
|---|---|---|
| Supabase | EU region (Frankfurt assumed — **confirm**) | EU adequacy (no transfer to UK) / UK-EU adequacy decision |
| Resend | US | Standard Contractual Clauses (SCCs) — **confirm in DPA** |
| Microsoft Azure AD | EU/UK datacentres | EU-US Data Privacy Framework; UK-US adequacy decisions pending |
| TravelTime API | UK | No transfer |
| OpenRouteService | EU (Germany) | UK-EU adequacy |
| Vercel | US (CDN edge) | SCCs — **confirm in DPA** |

### 4.1 Data Minimisation Principles Applied

- PVG reference numbers: **retain only cleared/not-cleared boolean** in Care Capacity unless legal requirement to retain full reference is confirmed.
- Client home address: postcode + geocoords sufficient for route analysis; full street address should remain in People Planner only.
- Pay-rate hours: used in capacity calculations — necessary; however, financial precision fields should not appear in viewer-role exports.
- Session/audit logs: retain for 12 months then purge (no current policy — **GAP**).

### 4.2 Retention Periods

| Data Category | Proposed Retention | Basis |
|---|---|---|
| Capacity analyses (employee + client operational data) | 15-week rolling window (current) | Operational necessity; minimisation |
| Platform user accounts | Duration of employment + 6 months | Art 5(1)(e); DSAR/audit capability |
| Audit logs | 12 months | Art 5(2) accountability; security investigation |
| Session tokens | 24 hours (rolling) | Security minimisation |
| Broadcast email logs | 6 months | Accountability |
| PVG status records | Duration of employment + 1 year (pending HR/legal confirmation) | DPA 2018 Sch 1; safer recruitment |

---

## Step 5 — Risk Assessment

**Scale**: Likelihood 1=Low 2=Medium 3=High | Severity 1=Low 2=Medium 3=High | Overall = L×S (1–3 Low, 4–6 Medium, 7–9 High)

| Risk | Likelihood | Severity | Overall | Notes |
|---|---|---|---|---|
| Unauthorised access to PVG / criminal-record data by an internal user with insufficient privilege | 2 | 3 | **6 — Medium** | Role-based controls exist; scheduler role can currently view joiner records |
| Automated People Planner scraper credentials compromised — attacker gains access to all HR/care data in source system | 2 | 3 | **6 — Medium** | Playwright session uses real user credentials stored as env secrets |
| Supabase misconfiguration exposes raw database to internet without row-level security | 1 | 3 | 3 — Low | Supabase accessed via server-side service role only; no direct client DB access observed |
| Client (vulnerable adult) care-needs data processed without a valid Art 9 condition | 2 | 3 | **6 — Medium** | Art 9(2)(h) likely applies but has not been formally documented |
| No formal Article 28 DPA with key processors (Supabase, Resend, TravelTime) | 3 | 2 | **6 — Medium** | Standard commercial risk; actively unmitigated |
| Subject Access Request cannot be fulfilled within one month — no tooling or procedure | 3 | 2 | **6 — Medium** | No DSAR log or export tool exists |
| Data subjects (care workers, clients) not informed Care Capacity processes their data | 3 | 2 | **6 — Medium** | No Care Capacity-specific privacy notice; primary notices may not reference this system |
| Excessive retention: employee/client data held beyond operational need with no automatic purge | 2 | 2 | 4 — Medium | 15-week rule applies to analyses; raw user/client tables have no automated purge |
| Route-optimisation processing of home addresses exceeds reasonable expectation — no LIA documented | 2 | 2 | 4 — Medium | LIA not yet drafted |
| Care worker home coordinates shared with TravelTime API without worker knowledge | 2 | 2 | 4 — Medium | No privacy notice covers this transfer |
| Resend email logs retain recipient email addresses and content indefinitely | 2 | 1 | 2 — Low | Resend retention policy to be confirmed |
| Vercel analytics collects page-view data including IP addresses of internal users | 1 | 1 | 1 — Low | Internal staff only; low risk |
| HTTPS / HSTS misconfiguration allows plaintext interception | 1 | 3 | 3 — Low | HSTS header confirmed present |
| Playwright automation breaks on People Planner UI change — silent data staleness | 2 | 2 | 4 — Medium | Data-quality/availability risk rather than privacy risk, but affects DSAR completeness |

---

## Step 6 — Measures to Reduce Risk

| Risk | Measure | Effect on Risk | Residual Risk | Approved |
|---|---|---|---|---|
| Unauthorised access to PVG data by scheduler | Restrict PVG status field to admin role only in API responses; add column-level check | Likelihood ↓ to 1 | Low | Pending |
| Scraper credentials compromised | Move People Planner credentials to dedicated service account; rotate quarterly; alert on failed login | Likelihood ↓ to 1 | Low | Pending |
| Art 9 condition not documented for client care data | Draft Art 9(2)(h) processing condition statement, reviewed by legal counsel | Severity ↓ | Medium → Low | Pending |
| No Article 28 DPAs with processors | Obtain signed DPAs from Supabase, Resend, TravelTime, OpenRouteService, Microsoft, Vercel | Severity ↓ to 1 | Low | Pending |
| No DSAR tooling | Build admin DSAR log + data export tool (see Step 4 / instruction set) | Likelihood ↓ to 1 | Low | Pending |
| Data subjects not informed | Update staff and client privacy notices; add in-app Privacy Notice page linked from footer and login screen | Likelihood ↓ to 1 | Low | Pending |
| No LIA for home postcode processing | Draft and document Legitimate Interest Assessment for route-optimisation use case | Residual → Low | Low | Pending |
| Audit log / user account retention gap | Implement automated purge job: user accounts → 6 months post-deactivation; audit logs → 12 months | Likelihood ↓ | Low | Pending |
| Care worker home coordinates shared with TravelTime | Disclose in updated staff privacy notice; evaluate whether postcode centroid is sufficient alternative | Likelihood ↓ | Low | Pending |

---

## Step 7 — Sign-Off and Record of Outcomes

| Item | Name / Position / Date | Notes |
|---|---|---|
| **Measures approved by** | [CEO / Operations Director — signature required] | Integrate actions into project plan with owners and target dates |
| **Residual risks approved by** | [CEO / Operations Director — signature required] | No residual high risks identified; all medium risks have mitigating measures above |
| **DPO / Privacy Lead advice** | Mustansar Hussain, Digital & Technology Team — July 2026 | See summary below |
| **Summary of DPO advice** | Processing can proceed on current architecture. Six medium risks require active remediation within 90 days (DPAs, privacy notice, DSAR tool, Art 9 documentation, LIA, PVG access restriction). No ICO consultation required at this time as no residual high risk remains after measures above are applied. | — |
| **DPO advice accepted / overruled by** | [CEO — signature required] | — |
| **Consultation responses reviewed by** | N/A — internal tool; no direct data-subject consultation conducted (justified: data subjects are not users of the system; processing is of HR/care data ingested from People Planner) | — |
| **This DPIA will be kept under review by** | Mustansar Hussain, Digital & Technology Team | Review annually, or on any material system change, new third-party integration, or new data category |

---

## Outstanding Actions (Priority Order)

| # | Action | Owner | Target | Status |
|---|---|---|---|---|
| 1 | Obtain Article 28 DPAs from Supabase, Resend, TravelTime, OpenRouteService, Microsoft (Azure AD), Vercel | Mustansar Hussain | 30 days | ⚠️ Open |
| 2 | Update staff and client privacy notices to reference Care Capacity | HR + Digital & Technology | 30 days | ⚠️ Open |
| 3 | Build in-app Privacy Notice page and link from login screen and footer | Digital & Technology | 30 days | ⚠️ Open |
| 4 | Build DSAR log and data-export tool in admin panel | Digital & Technology | 30 days | ⚠️ Open |
| 5 | Document Art 9(2)(h) processing condition for client care data | Legal + Digital & Technology | 45 days | ⚠️ Open |
| 6 | Draft Legitimate Interest Assessment for home-postcode route analysis | Privacy Lead | 45 days | ⚠️ Open |
| 7 | Restrict PVG field to admin role only in API | Digital & Technology | 14 days | ⚠️ Open |
| 8 | Confirm Supabase EU region in dashboard; confirm Resend SCC coverage | Digital & Technology | 14 days | ⚠️ Open |
| 9 | Implement automated retention purge for user accounts and audit logs | Digital & Technology | 60 days | ⚠️ Open |
| 10 | Formally appoint a registered DPO (if required under Art 37 — large-scale special-category processing) | CEO | 30 days | ⚠️ Open |

---

## What Cannot Be Declared by This Assessment

This document records a good-faith assessment of data protection risks and mitigations for Care Capacity as at July 2026. It does **not** constitute a declaration of "GDPR compliance" — no agent, consultant, or internal team can truthfully make that declaration about a live system. Formal legal sign-off by a human with appropriate authority, and formal DPO appointment under Article 37, remain outside the scope of this technical assessment.

---

*Prepared by Mustansar Hussain, Digital & Technology Team, Home Instead Scottish Group — July 2026*
*Next review: July 2027 or on any material system change*
