---
Care Capacity — Information Security Policy (internal, one-page)
Owner: Mustansar Hussain, Digital & Technology Team
Last updated: 30 July 2026
---

# Information Security Policy

This records the technical and organisational measures actually in place for Care Capacity, so Article 32 ("appropriate technical and organisational measures") can be demonstrated rather than asserted.

## Access Control
- Three-tier RBAC: admin > scheduler > viewer, enforced server-side on every protected route (`server/features/auth/auth.ts`).
- All `/api` routes require an authenticated session by default (`globalAuthGuard` in `server/app.ts`); routes are allow-listed to be public, not deny-listed to be private.
- Sessions are httpOnly, sameSite=Lax cookies backed by PostgreSQL session storage (`connect-pg-simple`).
- The Data Requests (DSAR) tool and user management are admin-role only.

## Data Protection in Transit and at Rest
- HTTPS/TLS enforced; HSTS header present.
- Passwords hashed with bcrypt, never stored or logged in plaintext.
- Database (Neon-hosted PostgreSQL) encrypts data at rest.
- Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, and Permissions-Policy headers are set on every response.

## Application Security
- SQL injection prevented by Drizzle ORM parameterised queries throughout.
- Input validation via Zod schemas on all write endpoints.
- Sentry captures error/performance telemetry to catch failures before they become incidents.

## Accountability
- Admin actions (user creation, role changes, broadcast sends, DSAR handling) are written to an append-only audit log.
- This policy, the DPIA, and the ROPA are reviewed annually or on any material system change.

## Known Residual Risks (documented, not hidden)
These are real gaps, tracked deliberately rather than fixed quietly, because closing them involves organisational decisions or dependency major-version upgrades that carry their own risk of breaking the running app (see the honest status report for detail):
- **No multi-factor authentication** on user accounts.
- **No automated retention purge** for user accounts or audit logs (see retention schedule).
- **PVG onboarding milestone flag visible to the scheduler role** — reviewed 30 Jul 2026 and judged appropriate (see DPIA); only a cleared/not-cleared flag is stored, and schedulers need it for their onboarding job function.
- **People Planner automation runs inside the main API process** in some deployments rather than an isolated worker, meaning a stuck automation job could affect API responsiveness.
- **Dependency vulnerabilities requiring a major-version upgrade are not yet patched** (`drizzle-orm`, `vite`, `uuid`, `brace-expansion`) — patch/minor-version fixes were applied 30 Jul 2026 (`multer`, `ws`); the remainder need scheduled testing before upgrading because they are breaking changes, not quick wins.
- Two SAST "path traversal" findings in the People Planner automation code were reviewed and are false positives: the file paths involved are built from a server-generated job ID, never from user-supplied request data.

## Incident Response
See `docs/internal/breach-response-procedure.md` for the breach notification procedure.
