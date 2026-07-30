---
name: DPO Standing Role — Care Capacity
description: Ongoing GDPR/privacy lead responsibilities and known compliance state for Care Capacity (Home Instead Scottish Group). Read before any feature that touches user data, auth, email, new third-party integrations, or admin tooling.
---

## Role
Mustansar Hussain (Digital & Technology Team) is the designated Privacy Lead / acting DPO for Care Capacity. As agent, I hold this role on an ongoing basis — not a one-off audit. Every material system change must be assessed against the standing DPIA/ROPA.

## Controller
SUR Group (trading as Home Instead Scottish Group)

## Product
Care Capacity — Workforce Intelligence Platform

## Core Documents
- DPIA: `docs/DPIA-Care-Capacity.md` — completed July 2026, revised 30 Jul 2026, next review July 2027 or on any material change.
- ROPA (Art 30, mandatory here due to special-category processing): `docs/ROPA-Care-Capacity.md`
- Internal one-pagers: `docs/internal/retention-schedule.md`, `information-security-policy.md`, `breach-response-procedure.md`, `dsar-procedure.md`
- In-app Privacy Notice: `client/src/pages/privacy-policy.tsx` (linked from login + footer) — this is the canonical, most current sub-processor list; DPIA/ROPA should defer to it if they ever drift apart.
- DSAR tool: Admin → Data Requests tab (`server/routes/data-requests.ts`, `client/src/pages/admin.tsx`) — admin-only log + due-date tracking + PDF export (strips password hashes/auth tokens). Erasure/rectification are deliberately manual, not automated by this tool.

## Special Category / Criminal-Offence Data Present
- **PVG status** — stored only as a cleared/not-cleared onboarding milestone flag (no disclosure reference numbers). Scheduler-role visibility was reviewed 30 Jul 2026 and judged appropriate for their onboarding job function — do not restrict to admin-only without re-checking what's actually stored first.
- **Client care-type / service-need data** — health-adjacent (Art 9(2)(h)), documented in ROPA Activity 3; still needs legal counsel sign-off on the Art 9 condition wording.

## Open Compliance Actions (see DPIA Outstanding Actions table for full current list/status)
Two items always require a human with authority the agent doesn't have — do not attempt to resolve these unilaterally:
1. Formal DPO appointment under Art 37 (CEO decision).
2. Article 28 DPA confirmation with every sub-processor (requires contracting authority).

Other open items: Art 9(2)(h) legal sign-off, LIA for postcode-based route optimisation, confirming Neon/Supabase hosting region, automated retention purge job for user accounts/audit logs.

## Rules for Future Changes
- Any new third-party integration → check if it receives personal data → needs an Art 28 DPA → update ROPA + Privacy Policy sub-processor list together (keep them in sync).
- Any new data field → ask: is it necessary? Does it touch special-category/criminal-offence data? → update ROPA.
- Any public-facing feature → ensure Privacy Notice is updated.
- Any AI/automated-decision feature → mandatory DPIA update (Art 22).
- Never claim "certified GDPR compliant" — GDPR has no certification scheme; describe compliance posture honestly (what's built vs. open risk) instead.

**Why:** Art 5(2) accountability — must be able to demonstrate compliance at any time, not just assert it. Art 33 imposes 72-hour breach notification. Art 12 imposes a 1-month DSAR response deadline. These require working tools and written procedures, not just policy documents.
