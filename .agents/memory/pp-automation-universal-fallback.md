---
name: PP automation backup policy
description: Single-attempt login policy, separate global backup, and Glasgow North account restriction.
---

A branch's dedicated Access Workspace account can get stuck on the identity/login page during tenant re-auth (observed as a Cloudflare "Verifying..." challenge on that specific account, even though the tenant itself and other accounts on it work fine). Retrying the same account just repeats the failure.

The owner wants the existing universal account retained and an additional global backup account, not a replacement. After one failed account attempt, switch directly to the extra backup; do not repeatedly retry either failed account. Send the owner an email when an automation account fails. This applies equally to Day Rate Financial Summary, single-week PP sync, and multi-week PP sync.

**Why:** the owner's explicit operational policy, following a dedicated-account Cloudflare challenge that did not affect the universal account on the same tenant.

**How to apply:** preserve the single-attempt policy across all automation paths. A busy backup must be waited for without repeating the failed login. Release reservations by the session that owns them, including when fallback or backup preparation fails.

Glasgow North must remain on the existing universal account for both Day Rate and PP. Do not use its dedicated account until the owner explicitly authorises switching back; new credentials alone are not sufficient permission.

**Why:** the owner said “dont use that i will let you know” while arranging replacement credentials.

**How to apply:** keep this branch's dedicated account disabled until the owner gives the go-ahead. The additional global backup may still be used if its current universal login fails.
