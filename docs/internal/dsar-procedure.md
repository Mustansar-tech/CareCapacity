---
Care Capacity — DSAR Handling Procedure (internal, one-page)
Owner: Mustansar Hussain, Digital & Technology Team
Last updated: 30 July 2026
---

# Data Subject Access Request (DSAR) Procedure

This is the internal process behind the in-app "Data Requests" admin tool (Admin → Data Requests tab). Article 12 requires a response within one calendar month of receipt; this procedure is what makes that deadline achievable in practice.

## Step 1 — Log the Request Immediately
As soon as any request arrives (email, phone, in person) for access, rectification, erasure, restriction, or portability:
1. Go to Admin → Data Requests → **Log Request**.
2. Enter the subject's name, email (if known), request type, and the date the request was received — the due date (received + 1 month) is calculated automatically.
3. Do not wait for identity verification before logging — the clock starts on receipt, not on verification.

## Step 2 — Verify Identity
Before disclosing any data, confirm the requester is who they claim to be (or has authority to act for that person, e.g. next of kin with legal authority). Note how identity was verified in the request's Notes field.

## Step 3 — Fulfil the Request

**Access / Portability** — use the **Export PDF** button on the request row. This pulls every record in Care Capacity matching the subject's name or email across all tables (platform account, audit activity, employee record, client record, joiner/leaver record, feedback) and strips password hashes and auth tokens automatically. Review the export before sending — redact anything that would reveal a third party's personal data mixed into free-text fields (e.g. notes mentioning another person).

**Rectification** — correct the record directly in its normal screen (People Planner is the master record for employee/client data; corrections made there will flow through on the next import). This tool does not edit data — it only tracks that a correction was requested and completed.

**Erasure** — delete the specific record(s) through their normal admin/management screens. This tool deliberately does **not** offer a delete button, so a misclick here can never destroy real operational data. Mark the request complete once erasure is done elsewhere.

**Restriction** — flag the record status appropriately in its normal screen (e.g. mark inactive) and note what restriction was applied.

## Step 4 — Update Status and Close
Set the request's status to **In Progress** while working on it, and **Complete** once the response has been sent to the data subject. The completion timestamp is recorded automatically.

## Step 5 — Track the Deadline
The Data Requests tab surfaces days remaining and flags overdue requests in red. Check it weekly. If a request is genuinely complex and needs the two-month extension permitted under Art 12(3), document that decision and inform the data subject before the original deadline expires — do not just let it go overdue silently.

## What This Tool Deliberately Does Not Do
It does not automate erasure or rectification, and it does not decide whether a request is valid or how to respond — those remain human judgement calls, exercised elsewhere in the app or in the underlying systems.
