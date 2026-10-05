# Activity and audit history

The Admin activity log records who performed an action, what happened, when it
happened, the branch and the affected record. Names and branch labels are captured
at event time; record IDs are retained as secondary technical references.

## Coverage

- Leaver and joiner creation, editing, archiving and permanent deletion.
- Availability changes and monthly snapshot editing/reopening.
- Existing sign-in/sign-out, consent, user-management, HR and data-request events.
- A request-level safety net records authenticated application mutations without a
  domain-specific event, and failed authenticated write requests. These safety-net
  entries identify the endpoint and subject when available; they are not
  field-level snapshots for every module.

Workforce changes are committed in the same database transaction as their audit
entry. If the audit insert fails, the workforce change rolls back. Other existing
workflows and request-level safety-net events do not yet have that same atomicity
guarantee. Read-only background calculations are not treated as user mutations.

## Reading and exporting

Search matches people, actors, branch labels, descriptions and references. Filters
cover action, branch and inclusive date ranges in Europe/London. Pagination covers
the full retained history rather than only the most recent 200 rows. Details show
before/after values and request context where captured. CSV export includes all
matching rows, with a 10,000-event limit requiring a narrower range above that.
CSV text is escaped to prevent spreadsheet formula execution.

## Privacy and limitations

Only a whitelist of operational/account fields is retained in snapshots.
Passwords and credentials are never stored; sensitive/free-text edits are noted
without their contents. Audit retention follows the existing 12-month target in
the internal retention schedule. Automatic enforcement remains an open compliance
action; this change does not silently purge or rewrite historical records.

Old ID-only permanent deletions cannot reliably acquire a name after the source
record is gone. Such entries remain labelled as legacy events. Application users
cannot edit or delete audit events. This is not a cryptographic tamper-evident
ledger and does not restrict a database owner's direct SQL access.

Structured details use a versioned JSON envelope inside the existing `detail`
column. No new database columns or deployment migration are required.
