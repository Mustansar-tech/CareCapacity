---
name: GH-loss roster eligibility
description: The current imported CG roster, not historical visit names or availability presence, determines GH-loss eligibility.
---

Only carers in the CG roster supplied with an import may acquire guaranteed-hours loss targets. A visit export can retain actual/planned names after a carer has left; those names must not recreate an ongoing employment obligation.

**Why:** A fresh automation reprocessed its exports correctly but still created false GH loss for a former carer from lingering visit rows. The user requested a permanent rule for future terminations, not a person-specific exclusion.

**How to apply:** Use the roster from that import with the shared employee-name normalization. Do not require availability membership: active carers on leave or without availability still need legitimate GH accounting. Preserve recorded worked hours, paid cancellations, client demand and cross-branch credits. Recalculate eligibility on every ingestion path; never carry the prior roster or target list forward.

Historical snapshots should be corrected only with the corresponding source evidence, not by applying today's roster across every past week.

**Why:** A carer can legitimately belong to an earlier week's roster before leaving, and rewriting history from a current roster would remove valid obligations.

**How to apply:** Scope any repair to the verified branch/week, retain visits and schedules, record the correction in the audit trail, and leave other snapshots untouched.
