---
name: Day Rate Tracker number formatting
description: Currency/number display convention for the Day Rate Tracker dashboard — never round, always 2 decimals.
---

The Day Rate Tracker dashboard (client/src/pages/day-rate-tracker.tsx) must
never round away real decimal pence, but must not pad whole-pound amounts
with ".00" either. Every currency value (revenue, day rate, summary cards,
grid cells, totals rows) is formatted with `maximumFractionDigits: 2` and
NO `minimumFractionDigits` on the shared Intl.NumberFormat instance — so
£100 stays "£100" and £108,728.35 stays "£108,728.35" (never rounded to
£108,728).

**Why:** explicit user requirement, refined after an initial overcorrection
that forced ".00" on whole numbers — these are board-facing figures pulled
from the People Planner Financial Summary automation, and any rounding was
considered a loss of precision/trust in the numbers.

**How to apply:** when adding any new monetary display to this dashboard
(new card, new column, new export), reuse the existing 2-decimal formatter
rather than introducing a 0-decimal one. This convention is specific to the
Day Rate Tracker; other pages in the app were not touched and may follow
different conventions.
