---
name: Employee identity key normalization
description: Any new "employee identity key" (for matching the same person across uploads) must reuse the shared normalizeName() — never invent an ad hoc key, or the same person silently splits into duplicate rows.
---

`normalizeName()` (defined in `server/features/imports/pipeline-utils.ts`, duplicated once more
in `server/features/imports/excel-visit-extractor.ts`) is the canonical way to turn a raw
employee name string into a stable identity key: lowercase, strip `(...)` annotations (GH hours
labels, LIC, etc.), strip all non-letter characters, strip titles, sort the words, join with
spaces.

The Workforce/HR-calendar sync (`server/repositories/hr.repository.ts`,
`syncHrCalendarFromResult`) used to build its own `employeeKey` inline with a weaker version of
this (only trimmed titles and whitespace, kept commas/parens/GH-labels). The same person's name
appearing slightly differently across weekly uploads (e.g. "Welsh, Caitlin" vs "Welsh, Caitlin
(GH12)", or a stray trailing comma) produced a different key each time, silently splitting them
into duplicate rows in the Workforce calendar — ~190 of 384 employees were affected before the
fix, requiring a one-off DB migration to merge duplicate identity groups by re-deriving the
canonical key from `employee_name` and consolidating rows per (branch, canonical key, date).

**Why:** raw name formatting is inconsistent across CG Data / GH Excel exports from week to
week (word order, trailing punctuation, presence/absence of GH annotation) — any key derived
from the raw string without full normalization will eventually diverge for the same person.

**How to apply:** whenever a new feature needs to key/group data by employee name, import and
use `normalizeName` from `pipeline-utils.ts` rather than writing new normalization logic. If a
duplication bug shows up as "the same person appears twice," suspect an ad hoc name-key first.
