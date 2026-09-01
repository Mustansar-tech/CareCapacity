---
name: Data House page structure (formerly Day Rate Tracker nav item)
description: How the "Data House" section (sidebar label) is organized — three top-level tabs, rolling month window, and archive pattern.
---

The sidebar nav item labelled "Data House" (route `/app/day-rate-tracker`, id
`day-rate-tracker`) opens a page with three top-level tabs: **Day Rate
Tracker**, **KPI Tracker**, **Annual Roadmap**. Each tab owns its own
page-specific controls (buttons, status banners) — only the generic title
lives outside the tabs. When adding tab-specific UI (buttons, alerts, status
cards), put it inside that tab's `TabsContent`, not in the shared header,
or it leaks into the other tabs.

Inside "Day Rate Tracker", months are shown via a **rolling 3-tab window**
(last closed / current / next calendar month), computed live from today's
date — it isn't a fixed list, so it silently advances every month with no
manual update needed. Older closed months are intentionally not kept as
permanent tabs (that would grow unbounded); instead there's a 4th
"Previous months" tab (only rendered when older data exists) with a
Select dropdown sourced from `/api/day-rate/months`, showing any past month
on demand via the same `MonthGrid` component.

**Why:** keeps the tab bar from accumulating one tab per month forever,
while still making full history reachable.

**How to apply:** if the rolling-window logic (`getComparisonMonths`) ever
changes, keep the archive filter (`months < previousMonth`) in sync so there's
no gap or overlap between the rolling tabs and the archive dropdown.
