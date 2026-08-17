---
name: Shared processing pipeline paths
description: Every pipeline change (carer-home-branch mapping, HR calendar sync, etc.) must be applied via one shared function called from every ingestion path, or some paths silently keep the old/broken behavior.
---

Care Capacity has multiple independent code paths that ingest the same kind of weekly data:
- Manual upload (`server/controllers/process.controller.ts`)
- People Planner automation, single-week (`server/features/people-planner/automation-routes.ts`)
- People Planner automation, multi-week loop (same file, separate branch)

Both the carer→home-branch mapping fix and the HR-calendar employee-key normalization fix were
originally only wired into the manual-upload path and had to be retrofitted into the automation
paths after the gap was discovered live (carers/employees silently missing or duplicated only
when data came in via automation, not manual upload).

**Why:** these paths evolved separately over time; a fix applied to only one of them looks
complete (tests/manual checks against manual upload pass) but leaves the automation paths on
the old, buggy behavior indefinitely since they're exercised on a schedule, not by hand.

**How to apply:** any time you fix or change logic that runs at ingestion time (name
normalization, dedup keys, persistence of derived mappings, etc.), put the logic in one shared
function in a `repositories/*.ts` file and call it from all three ingestion sites above — never
duplicate the logic inline in a controller/route. When investigating a bug that "only happens
sometimes," check whether it's present in all three paths before concluding it's fixed.
