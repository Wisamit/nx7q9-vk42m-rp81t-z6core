# Stage 89 — MFA challenge single-use and password-rotation fencing

## Reason
After owner-confirmed Stage 88 Hostinger deployment, code review found MFA verification checked unconsumed challenges and recovery codes outside its write transaction, then consumed the challenge with an unconditional Prisma update. Concurrent attempts could therefore both pass the pre-read and produce sessions; password rotation could race with verification of a pre-reset challenge. Clinical and financial multi-branch user-session trust is security-critical.

## Implemented
- `POST /api/auth/mfa/verify` authenticates a challenge within a single Serializable transaction. It locks the staff user row **first**, then the exact challenge row, re-reads the latest user/organization/branch and challenge status while locked, checks secret, OTP or recovery hash while locked, atomically claims unconsumed unexpired challenge using a conditional update (`claimed.count === 1`) **before** creating the session. It commits user recovery-code consumption, session issuance and login audit together. Failed claims/OTP never commit a session or consume a recovery code.
- `canFinalizeMfaChallenge` rejects consumed/expired/future-issued challenges, login challenges created before a password rotation, disabled/inactive user or organization, missing MFA secret.
- Password self-rotation now revokes all pending MFA login challenges in the same transaction as password hash update and user-session revocation. Stage 88 admin-reset challenge invalidation retained. Existing MFA enrollment and recovery-code mechanisms remain.
- Branch scope must belong to the authenticated user organization and be active.
- Existing rate-limit, HttpOnly/SameSite/Secure cookie policies and audit remain; no password, recovery code or TOTP seed leaked to logs.
- No new migration or environment variable. Existing pending challenges retain normal five-minute expiry, and all new challenges use the improved verifier.

## Tests and release
- Node safety tests cover exact expiry, consumed, password epoch, status/MFA invalidation, row-lock order, conditional claim then session insert, and password self-reset challenge invalidation.
- Two-connection MariaDB test proves user locks fence a concurrent password change, challenge claims are single-use with no second row affected, exactly one session issued, later password epochs block old challenge, and session revocation remains durable.
- Full existing CI suite and Next.js production build required on exact feature and merged main SHA before deployment. Branch remains separate from Analyzer Bridge PR #128 which must stay draft/unmerged.
- Future work still includes device/session management, provisioning, clinical operations and full Master Scope. This stage does not replace security certification or human clinical UAT.

## Merged release verification
Mainline merge 8f1f0927da63d67124335e208adaa2aa6ba2f95f after feature CI #1098 success; this document-only release note also checks push CI for the same implementation tree.
