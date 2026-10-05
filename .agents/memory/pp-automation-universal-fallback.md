---
name: PP automation backup policy
description: Single-attempt login policy, two global backups, and Glasgow North dedicated-account authorisation.
---

A branch's dedicated Access Workspace account can get stuck on the identity/login page during tenant re-auth (observed as a Cloudflare "Verifying..." challenge on that specific account, even though the tenant itself and other accounts on it work fine). Retrying the same account just repeats the failure.

The owner wants the existing universal account and the additional global backup retained for the same failover purpose. After one failed dedicated-account attempt, try the universal account, then the extra backup, once each. If one global account is busy, use the other if free. Do not repeatedly retry any failed account. Send the owner an email when an automation account fails. This applies equally to Day Rate Financial Summary, single-week PP sync, and multi-week PP sync.

**Why:** the owner's explicit operational policy, following a dedicated-account Cloudflare challenge that did not affect the universal account on the same tenant.

**How to apply:** preserve the single-attempt policy across all automation paths. A busy backup must be waited for without repeating the failed login. Release reservations by the session that owns them, including when fallback or backup preparation fails.

On 2026-10-05 the owner confirmed replacement credentials and explicitly authorised Glasgow North to use its dedicated account again for both Day Rate and PP.

**Why:** the owner has now given the requested go-ahead after the earlier temporary restriction.

**How to apply:** start Glasgow North on its dedicated account. Both global accounts remain eligible for failover, with one attempt per account per session.
