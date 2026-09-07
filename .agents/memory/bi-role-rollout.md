---
name: BI role rollout
description: Current Operations Director BI permission boundary, and the session-role-refresh bug fixed while rolling it out.
---

The role is `operations_director` (renamed from an earlier `bi_user`). It has the same visibility and editing rights as an administrator within SUR Group BI (Data House, KPI Tracker, Annual Roadmap, Scoreboards, automation status visibility), but must not be allowed to start People Planner/Financial Summary automation — that stays administrator-only.

**Why:** the user explicitly chose one broad BI access role as the first incremental step, deferring a more detailed multi-persona permission model (that follow-up was proposed as a task and later cancelled).

**How to apply:** new BI pages and data endpoints should admit both administrators and Operations Directors. Any action that starts People Planner or Financial Summary automation must remain administrator-only until the permission model is deliberately revised.

**Session role must be re-fetched live, never trusted from login-time session state.** `req.session.userRole` is set once at login. If an admin changes a user's role while they're already logged in, the client (`/api/auth/me`) picks up the new role immediately and shows the right nav, but server-side `requireRole`/`requireRoleAtLeast` checks against the stale session role kept rejecting every API call — the user saw the nav link but every page inside it 403'd, looking like "cannot access BI at all."

**How to apply (session bug):** any role/permission check gating a request must re-derive the role from the DB rather than reading `req.session.userRole` directly. `server/features/auth/auth.ts` does this via a shared helper used by both `requireRole` and `requireRoleAtLeast`, which also refreshes `req.session.userRole` in lockstep. Apply the same pattern to any future auth/session-cached permission check.
