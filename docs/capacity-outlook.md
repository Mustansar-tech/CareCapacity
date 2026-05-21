# Capacity Outlook — Rules, Logic & Improvement Notes

## What It Does

Gives each branch a rolling 4-week forward view of staffing capacity — how many hours are about to be **lost** through leavers, versus how many hours are expected to be **gained** through people in the recruitment pipeline. The result is a RAG (Red / Amber / Green) signal per week so managers can spot capacity shortfalls before they happen.

---

## How Hours Lost Is Calculated (Leavers)

Each active leaver contributes a weekly loss based on their **Last Working Day**.

| Scenario | Hours counted as lost |
|---|---|
| Last working day is before the week starts | Full weekly hours (they are already gone) |
| Last working day falls inside the week | Proportional: `weeklyHours × (7 − daysWorked) / 7` |
| Last working day is after the week ends | Zero (they are still fully available this week) |

**Example:** A carer works 30 hrs/week. Their last working day is a Wednesday (3 days into the week). They work 3 days, so the loss for that week = `30 × (7 − 3) / 7 ≈ 17.1 hrs`. From the following week onwards the full 30 hrs is counted as lost.

### Fields required for a leaver
| Field | Purpose |
|---|---|
| Employee name | Display only |
| Employment type | Driver or Walker |
| Weekly hours | The hours being lost |
| First day of notice | Informational |
| Last working day | **Drives the calculation** |
| Termination date | Must be ≥ last working day (server-enforced) |
| Leaving reason | Informational |
| Re-recruit eligible | Yes / No flag |

---

## How Hours Gained Is Calculated (Joiners)

Each active pipeline candidate contributes weighted hours based on their **Expected Start Date** and their **recruitment stage**.

```
Contribution = desiredWeeklyHours × confidenceWeight × daysInWeek / 7
```

- If the expected start date is before the week starts → full weighted hours for that week.
- If the expected start date falls inside the week → prorated by how many days of the week remain.
- If the expected start date is after the week ends → zero contribution.

### Confidence weights by recruitment stage

| Stage | Weight | Rationale |
|---|---|---|
| Confirmed start / Started | 75% | Near-certain, small risk of no-show |
| Training booked | 70% | Committed but not yet started |
| Pre-employment checks / Offer | 60% | Offer made, checks in progress |
| Interview / Pipeline | 50% | In process, meaningful drop-off risk |
| Dropped | 0% | Excluded entirely |
| (Unknown stage) | 50% | Conservative default |

Weights are set automatically from the stage — you do not enter them manually. They recalculate whenever a stage is updated.

### Fields required for a joiner
| Field | Purpose |
|---|---|
| Candidate name | Display only |
| Employment type | Driver or Walker |
| Desired weekly hours | The hours expected to be gained |
| Stage | **Sets the confidence weight** |
| Training date | Informational, helps judge stage accuracy |
| Expected start date | **Drives the calculation** |

---

## RAG Status Rules

Applied independently to each week and to the 4-week total.

| Coverage ratio | Status |
|---|---|
| No leavers this week | 🟢 Green |
| Gained ≥ 100% of lost | 🟢 Green |
| Gained 50–99% of lost | 🟡 Amber |
| Gained < 50% of lost | 🔴 Red |

Coverage ratio = `hoursGained / hoursLost` (capped at 1.0 for display purposes).

---

## KPI Cards

| Card | What it shows |
|---|---|
| Hours Lost | Total hours leaving across all 4 weeks |
| Hours Gained | Total weighted pipeline hours across all 4 weeks |
| Net Change | Gained minus Lost (negative = shortfall) |
| Coverage | Overall ratio as a percentage |
| RAG | Single traffic-light for the whole 4-week horizon |

---

## Data Lifecycle

- **Leavers** are soft-deleted (status → `processed`) when removed — the record is kept for audit purposes.
- **Joiners** are soft-deleted (status → `dropped`) when removed.
- Only `active` leavers and `active` joiners appear in the main view. Processed / dropped records are hidden by default.
- All creates, updates, and deletes are written to the audit log with the acting user, branch, and timestamp.

---

## Access Control

| Action | Minimum role |
|---|---|
| View the page and charts | Any authenticated user |
| Add / edit / delete leavers | Scheduler or Admin |
| Add / edit / delete joiners | Scheduler or Admin |

---

## Potential Improvements

### Calculation accuracy
- **Actual hours lost, not contracted hours** — currently we use `weeklyHours` as entered. If a carer is already on reduced hours or sick leave, the figure could be wrong. Linking to the People Planner sync data would give a more accurate base.
- **Partial-week gain rounding** — the proration divides by 7 calendar days. In practice a new starter might only have working days counted. Switching to `workingDays / 5` per week would be more precise for part-time staff.
- **Stage → weight calibration** — the weights are currently fixed estimates. Tracking historical stage-to-outcome data would let you replace them with branch-specific conversion rates (e.g. your Interview → Started rate might be 70%, not 50%).

### Coverage horizon
- **Extend beyond 4 weeks** — the server already accepts a `weeks` parameter (max 12). Adding a horizon selector (4 / 8 / 12 weeks) to the UI is a small change and would be valuable for advance planning.

### Automation
- **Auto-import leavers from People Planner** — when a PP sync runs and a carer's end date is populated, automatically create or update the leaver record instead of requiring manual entry.
- **Auto-import joiners from a recruitment system** — if the branch uses an ATS, a webhook or nightly import could keep the pipeline list in sync without manual data entry.

### Alerts
- **Email / notification when a week turns Red** — a scheduled job (e.g. run each Monday) could send a summary to branch managers showing any Red weeks in the next 4 weeks.
- **"Expiry" reminders for stale joiners** — if a joiner's expected start date passes without them being marked as Started or Dropped, surface a warning so the list stays accurate.

### Reporting
- **Historical trend** — storing a weekly snapshot of the RAG state per branch would allow a simple chart showing whether capacity outlook has been improving or worsening over time.
- **Cross-branch view** — an Admin-only summary row showing aggregate RAG across all branches at once, useful for regional managers.
