---
name: Audit identity and privacy
description: User's audit-trail requirement and privacy constraints when expanding audit coverage.
---

Audit events must explain which person or business record was affected in plain
language. An internal ID alone does not meet the user's requirement.

**Why:** The user reported that a permanently deleted leaver could not be identified
from the Activity Log because the entry contained only an ID.

**How to apply:** Preserve the subject's name and branch label at event time;
renaming or deleting the source record must not make the history unintelligible.
Never invent a missing historical name after a permanent deletion.

Distinguish permanent deletion, archiving, and failed attempts. Request-level
logging is a useful safety net, but must not be presented as a complete
field-by-field audit.

**Why:** A completed HTTP request does not prove every intended field changed,
and some workflows can partially succeed before returning an error.

**How to apply:** When extending coverage, capture before/after state and commit
local mutations with their audit entry wherever possible. Describe guarantees
honestly for external-service operations and request-only events.

Audit accountability does not justify retaining private care notes, credentials,
or PVG/disclosure contents.

**Why:** Audit snapshots survive deletion of the source record and extend the
retention of personal information.

**How to apply:** Retain necessary identifying names and minimal operational
values; note sensitive/free-text changes without copying the values. Assess
extensions against the standing DPIA and ROPA.
