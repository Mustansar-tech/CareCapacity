---
name: DPO Standing Role — Care Capacity
description: Ongoing GDPR/privacy lead responsibilities and known compliance state for Care Capacity (Home Instead Scottish Group). Read before any feature that touches user data, auth, email, new third-party integrations, or admin tooling.
---

## Role
Mustansar Hussain (Digital & Technology Team) is the designated Privacy Lead / acting DPO for Care Capacity. As agent, I hold this role on an ongoing basis — not a one-off audit. Every material system change must be assessed against the standing DPIA.

## Controller
Home Instead Scottish Group (SUR Group)

## Product
Care Capacity — Workforce Intelligence Platform

## Full DPIA Location
`docs/DPIA-Care-Capacity.md` — completed July 2026, next review July 2027 or on any material change.

## Special Category / Criminal-Offence Data Present
- **PVG (Protecting Vulnerable Groups) status** — criminal-offence data (Art 10 UK GDPR / DPA 2018 Sch 1). Currently visible to scheduler role — **must be restricted to admin only (open action)**.
- **Client care-type / service-need data** — health-adjacent (Art 9(2)(h)). Art 9 condition not yet formally documented.

## Lawful Bases in Use
- Art 6(1)(b) — employment/care contract
- Art 6(1)(c) — legal obligation (safer recruitment / PVG)
- Art 6(1)(f) — legitimate interests (route optimisation, audit logging) — **LIA not yet drafted for home-postcode use**
- Art 9(2)(h) — health/social care (client data) — **not yet formally documented**

## Data Subject Types
1. Care workers (employees) — name, address, postcode/geocoords, hours, PVG, references
2. Service users / clients (vulnerable adults) — name, address, care schedule, service type
3. Internal platform users — email, name, role, session, audit events

## Third Parties (all need Article 28 DPAs — none confirmed yet)
| Processor | Purpose | Location | DPA status |
|---|---|---|---|
| Supabase | DB + Auth | EU (Frankfurt — unconfirmed) | ❌ Not obtained |
| Resend | Transactional email | US | ❌ Not obtained |
| Microsoft Azure AD | SSO | EU/UK | ❌ Not reviewed |
| TravelTime API | Route/travel time | UK | ❌ Not obtained |
| OpenRouteService | Geocoding | EU (Germany) | ❌ Not obtained |
| postcodes.io | Postcode lookup | UK | ❌ Not obtained |
| Vercel | Frontend CDN + analytics | US | ❌ Not obtained |
| Access Workspace (People Planner) | Source system / data origin | UK | ❌ Not obtained |

## Retention Policy (established in DPIA — not yet enforced in code)
- Capacity analyses: 15-week rolling window (enforced)
- Platform user accounts: employment duration + 6 months (NOT enforced — GAP)
- Audit logs: 12 months (NOT enforced — GAP)
- Session tokens: 24h rolling (enforced)

## Open Compliance Actions (priority order)
1. ❌ Article 28 DPAs from all processors above
2. ❌ Update staff/client privacy notices to reference Care Capacity
3. ❌ Build in-app Privacy Notice page — link from login screen + footer
4. ❌ Build DSAR log + data-export tool in admin panel
5. ❌ Document Art 9(2)(h) condition for client care data
6. ❌ Draft LIA for home-postcode route-optimisation processing
7. ❌ Restrict PVG field to admin role only in API
8. ❌ Confirm Supabase EU region; confirm Resend SCC coverage
9. ❌ Implement automated retention purge (user accounts + audit logs)
10. ❌ Formally appoint registered DPO under Art 37 (CEO decision)

## Rules for Future Changes
- Any new third-party integration → check if it receives personal data → obtain Art 28 DPA → update DPIA
- Any new data field → ask: is it necessary? Does it touch special-category data?
- Any public-facing feature → ensure Privacy Notice is updated
- Any AI/automated-decision feature → mandatory DPIA update (Art 22)
- Any international transfer outside UK/EU → SCC / adequacy assessment required

**Why:** Art 5(2) accountability — must be able to demonstrate compliance at any time. Art 33 imposes 72-hour breach notification. Art 12 imposes 1-month DSAR response. These deadlines require written procedures to meet consistently.
