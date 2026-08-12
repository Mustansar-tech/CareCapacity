---
name: Enquiry stars byWeek format
description: Storage format for client enquiry starred selections after the multi-week matcher upgrade
---

`client_enquiries.starredSelections` now stores `{ byWeek: { [weekStartDate]: StarredMap } }` (new multi-week records). Legacy records store a flat `StarredMap`; the client detects the wrapper via `isStarredByWeekWrapper` and maps legacy maps under the synthetic key `"legacy"`.

**Why:** The matcher runs the enquiry against the selected week plus all future processed weeks and stars per week; a flat map can't represent per-week choices, but old saved enquiries must keep rendering and stay editable.

**How to apply:** Any code reading `starredSelections` must handle both shapes. New writes always use the `{ byWeek }` wrapper. The multi-week results shape is `{ weeks: [{ weekStartDate, visitResults }], recommendedStars }` — detect with `isMultiWeekResult`. ORS reuse across weeks relies on `orsMatrixBatch` being cache-aware (it skips fully-cached batches, no sleep/API call).
