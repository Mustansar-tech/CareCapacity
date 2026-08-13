---
name: GH loss cross-branch credit
description: How GH loss credits hours a carer works in other branches, and where carer home branches come from
---

**Rule:** GH loss must credit hours a GH carer works in other branches back to her home branch. Home branch is recorded in `carer_home_branches` (upserted on every CG Data upload from the file's "Branch" column, matched against branches.display_name/name; falls back to the uploading branch when unmatched).

**Why:** Carers like Kirsty Bullen cover visits in another branch; without the credit the home branch's GH Loss Breakdown showed her as ~29h short when she was actually working.

**How to apply:** Endpoint `GET /api/gh-loss/cross-branch?dates=...` sums cp_scheduled_visits hours in other branches per normalized carer name, restricted for non-admins to their assigned branches, and only credits carers whose recorded home branch equals the requesting branch (unmapped carers kept for legacy data). Client `computeGhLoss` takes the map as third arg. Known gap: overnight visits are skipped by the visit extractor so overnight cross-branch cover isn't credited (user cancelled the follow-up task).
