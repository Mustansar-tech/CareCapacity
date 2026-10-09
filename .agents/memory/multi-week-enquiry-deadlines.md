---
name: Multi-week enquiry deadlines
description: Keep week-level deadlines and fresh run-scoped lookups while reporting real enquiry progress.
---

Bound each enquiry week independently, not the entire rolling window to the
same 90-second limit. Retain short individual provider deadlines, shared
quota protection and a finite whole-run limit.

**Why:** A nine-week enquiry had successful ORS batches but stopped during
the fifth week because the app's overall 90-second timer included all
matching and database work. The user asked for scheduling-style travel
numbering in the Search button and removal of repeated carer lookups.

**How to apply:** Use one fresh branch-scoped location snapshot per enquiry,
reuse the isolated travel cache across its weeks, and report actual completed
weeks/travel batches. Do not persist route caches or share snapshots across
searches. Final results and recommended stars must include every requested
week before autosaving; stream interruption or a failed week is not success.
If a stream fails after headers were sent, audit its logical failure rather
than interpreting HTTP 200 transport as a successful operation.
