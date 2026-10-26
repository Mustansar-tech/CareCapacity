---
name: Joiner contract offer rules
description: Confirmed business rules for the planned availability-based joiner GH recommendation.
---

New joiner availability must start entirely unticked. The uploaded workbook's selections are examples, not defaults.

The user confirmed that the minimum GH offer is 4 hours per week for both drivers and walkers, and calculated hours must remain exact (for example, 33.75), not rounded to whole hours.

**Why:** The workbook states the minimum only on the driver sheet and does not specify rounding; the user explicitly resolved both ambiguities.

**How to apply:** Use these rules when implementing the joiner availability calculator. Do not infer candidate availability from the workbook's sample selections.

Availability, recommended GH hours, desired hours, and agreed contracted hours are separate. A Bank/zero-hours agreement must retain the joiner's availability, and recommendations must not automatically overwrite an agreed contract.

**Why:** The user explicitly asked how availability works without contracted hours and approved keeping these independent.

**How to apply:** Recalculate recommendations when type or availability changes, but apply them to agreed hours only on an explicit user action.

The joiner timetable must use the available desktop space and must not require sideways scrolling to reach days.

**Why:** The user rejected the first narrow, vertically stacked dialog because it clipped weekend columns and introduced nested scrollbars.

**How to apply:** Keep the desktop form wide with the whole week visible, adapt the timetable for small screens rather than overflow it, and verify the actual modal at desktop and mobile widths.
