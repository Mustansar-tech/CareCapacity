---
name: Day Rate Tracker number formatting
description: Currency/number display convention for the Day Rate Tracker dashboard — never round, always 2 decimals.
---

The Day Rate Tracker dashboard (client/src/pages/day-rate-tracker.tsx) must
never round monetary figures to whole pounds. Every currency value (revenue,
day rate, summary cards, grid cells, totals rows) is formatted with both
`minimumFractionDigits: 2` and `maximumFractionDigits: 2` on the shared
Intl.NumberFormat instance, so a whole-pound amount still displays as
"£100.00", not "£100".

**Why:** explicit user requirement — these are board-facing figures pulled
from the People Planner Financial Summary automation, and rounding was
considered a loss of precision/trust in the numbers.

**How to apply:** when adding any new monetary display to this dashboard
(new card, new column, new export), reuse the existing 2-decimal formatter
rather than introducing a 0-decimal one. This convention is specific to the
Day Rate Tracker; other pages in the app were not touched and may follow
different conventions.
