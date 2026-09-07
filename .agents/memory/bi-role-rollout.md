---
name: BI role rollout
description: Current BI User permission boundary and the intended direction for future persona-based permissions.
---

The BI User role has the same visibility and editing rights as an administrator within SUR Group BI, including automation status visibility. It must not be allowed to start automation. Administration remains restricted to administrators.

**Why:** The user explicitly chose one broad BI access role as the first incremental step, while deferring the more detailed multi-persona permission model.

**How to apply:** New BI pages and data endpoints should admit both administrators and BI Users. Any action that starts People Planner or Financial Summary automation must remain administrator-only until the permission model is deliberately revised.