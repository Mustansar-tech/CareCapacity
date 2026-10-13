---
name: SUR BI data vision
description: The user's stated long-term scope for cross-platform leadership reporting and source-system constraints.
---

SUR BI is a major group-level reporting project for leaders, the board, and managers. The goal is to bring relevant performance data into one place so users can assess whether the business is winning or losing. Intended sources include Care Capacity/People Planner, Xero, Zoho Books, and Jobtrain. People Planner currently has no API access, so its existing report/automation route remains relevant.

The organisation already uses Joiin for finance-team reporting to the owner; the broader SUR BI goal is to make cross-functional reporting available to multiple teams, not to replace Joiin by default.

**Why:** The user explicitly described SUR BI as a large project to consolidate all relevant KPI data across these systems for leadership decisions.

**How to apply:** Design around trusted, consistently defined cross-source KPIs rather than copying every field. Assess whether Joiin can supply the finance figures already used before building duplicate Xero/Zoho pipelines. Confirm each source's available data, API access, permissions, and refresh constraints; preserve the existing People Planner path unless API access changes.
