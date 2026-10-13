---
name: SUR BI data vision
description: The user's stated long-term scope for cross-platform leadership reporting and source-system constraints.
---

SUR BI is a major group-level reporting project for leaders, the board, and managers. The goal is to bring relevant performance data into one place so users can assess whether the business is winning or losing. Intended sources are Care Capacity/People Planner, Xero, Zoho CRM, Jobtrain, and My Learning Cloud's Lumis LMS. Zoho Books is not used. People Planner currently has no API access, so its existing report/automation route remains relevant.

The organisation already uses Joiin for finance-team reporting to the owner; the broader SUR BI goal is to make cross-functional reporting available to multiple teams, not to replace Joiin by default.

The user identifies “Dashboard 1” in the BI development workbook as the teams’ working KPI scope. It is a starting point, not a closed catalogue: additional useful KPIs are welcome, and the intended coverage is the whole SUR organisation.

**Why:** The user explicitly described SUR BI as a large project to consolidate all relevant KPI data across these systems for leadership decisions.

**How to apply:** Design around trusted, consistently defined cross-source KPIs rather than copying every field. Joiin normally syncs Xero daily; use a manual Quick sync for urgent changes and reserve full Slow syncs for historical refreshes because providers throttle frequent requests ([Joiin guidance](https://support.joiin.co/support/solutions/articles/42000026755-managing-companies-and-groups)). Assess whether Joiin can supply the finance figures already used before building a separate Xero pipeline; treat Zoho CRM as a distinct operational source, not Zoho Books. Confirm each source's available data, API access, permissions, and refresh constraints; preserve the existing People Planner path unless API access changes. Lumis advertises API access under Pro, but confirm the user's package and technical API details with the vendor.
