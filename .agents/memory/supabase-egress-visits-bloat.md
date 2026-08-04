---
name: Supabase egress / visits table bloat root cause
description: How we diagnosed a Free Plan egress overage and found a write-path bug causing unbounded row duplication.
---

When diagnosing Supabase Free Plan egress/storage overages, don't assume it's read traffic (polling, unbounded SELECTs) — check `pg_total_relation_size` across all tables first (`SELECT relname, pg_total_relation_size(relid) FROM pg_catalog.pg_statio_user_tables ORDER BY 2 DESC`). One table can dwarf the rest.

**Root cause found here:** the capacity-analysis upload pipeline (`geographical-extraction.ts`) extracted visit rows from an Excel upload and called `saveVisit()` (a plain INSERT) once per row on every processing run, with no delete/upsert of prior rows for the same dates first. Re-processing the same week's data repeatedly caused the same visits to be inserted again and again — one client/date/time combo had accumulated 45 duplicate rows. This grew a table to 614k rows / 257MB from what should have been ~40k rows / 14MB.

**Why:** any pipeline that re-runs over the same logical time window (daily sync, re-upload, retry) must clear or upsert the prior rows for that window before inserting, or storage/egress grows unbounded even though the *logical* dataset size is stable.

**How to apply:** before bulk-inserting rows scoped to a set of dates/keys, delete existing rows for that same scope first (see `clearVisitsForDates` in `server/repositories/geo.repository.ts`). Also watch for N+1 read patterns in the same kind of per-row processing loop (was calling `getClientLocationByName` once per row instead of batch-fetching all locations for the branch upfront).
