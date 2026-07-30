---
Care Capacity — Data Retention Schedule (internal)
Owner: Mustansar Hussain, Digital & Technology Team
Last updated: 30 July 2026
---

# Retention Schedule

This is the single source of truth for how long each category of personal data is kept in Care Capacity, and why. It exists to satisfy Article 5(1)(e) (storage limitation) and Article 5(2) (accountability — being able to demonstrate the policy, not just have one).

| Data category | Retention period | Enforcement | Basis |
|---|---|---|---|
| Employee/client scheduling data (postcode, hours, visits) | 90 days after last active branch upload | Automatic — 15-week rolling window purge | Operational necessity, minimisation |
| Platform user accounts | Duration of active account + 12 months after deactivation | **Manual — not yet automated** | Contractual, DSAR/audit capability |
| Audit logs | 12 months | **Manual — not yet automated** | Art 5(2) accountability, security investigation |
| Session tokens (connect.sid) | Duration of session | Automatic (express-session) | Security minimisation |
| Data request (DSAR) log | 3 years | Manual | Evidence of one-month deadline compliance |
| Sentry error/performance data | 90 days | Automatic (Sentry default) | Platform stability |
| Resend email delivery logs | 30 days | Automatic (Resend default) | Operational monitoring |
| People Planner automation session data | Deleted immediately after report download | Automatic | Data minimisation |

## Known Gap

Platform user accounts and audit logs have a documented target retention period but no automated purge job yet — deletion today would require a manual database operation. This is tracked as an open action in the DPIA (`docs/DPIA-Care-Capacity.md`, action #9). Until the purge job exists, this data is retained indefinitely by default rather than silently over-retained without anyone knowing — flagging it here is what makes that a documented, reviewed risk rather than a hidden one.

## When This Changes

Any new table storing personal data must get a row in this schedule before it ships. If a feature needs a different retention period than the defaults above, document the reason inline in this file rather than leaving it undocumented.
