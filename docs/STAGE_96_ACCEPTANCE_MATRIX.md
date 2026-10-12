# Stage 96 — High-Risk Clinical/Financial Step-Up Approval Evidence

## Baseline
- User-confirmed successful Hostinger deployment: `e90c15bf6081434fa9f63b90af0924dcd6b472cd` (Stage 95).
- Master Scope §64 (electronic approval/signature) and §82 (clinical security): re-authentication/PIN/MFA before high-risk approvals where required, with independently traceable actor/session proof.
- Existing Stage 89 staff MFA and standard password verification remain the authority. No new MFA system and no replacement of result validation, discount policies, refund constraints, QC, specimen custody or immutable report versioning.

## Implemented guarded decisions
1. **Medical validation approval** only. Medical return for correction remains possible without high-risk issuance, preserving patient safety.
2. **Released diagnostic report creation**, including amended versions.
3. **Discount approval** only. Discount rejection remains possible without financial sign-off.
4. **Refund posting** bound to payment, invoice, exact amount text and payment method. No rework of existing transaction/settlement arithmetic.

The existing authorization, branch permission, clinical and finance invariants continue to apply **in addition** to new step-up requirements. Only a reauthenticated staff member with the original permission can act.

## One-time proof architecture
- `POST /api/security/step-up` takes a narrowly validated action, exact resource key, active branch, current password and TOTP when MFA is enabled. UI captures password in `type=password`; the browser never persists credentials or issued token. HTTPS deployment is required.
- Provider-independent bcrypt verification and existing encrypted staff MFA secret/TOTP verification. Recovery codes are **not accepted** for approval evidence. Staff without enrolled MFA must supply their password; MFA-enrolled staff must supply both factors.
- Issuance rechecks current user/session, organization, active branch and user-branch membership; locks the `users` row to serialize distributed guessing; stores an attempt for every credential attempt. Five failures per rolling 15 minutes block further issuance. Existing account lockout is also honored.
- Random 256-bit token, only SHA-256 digest stored, expires after **2 minutes**, never logged. Token is scoped to `userId + sessionId + organizationId + branchId + action + resourceKey`.
- Protected mutation supplies token in `x-staff-step-up-token`. The **same transaction** that posts the financial/clinical outcome atomically claims the grant via `consumed_at IS NULL` compare-and-swap and appends `STAFF_STEP_UP_CONSUMED` audit evidence. If the downstream mutation rolls back, so does consumption and approval audit. A second concurrent request or mismatched/expired token fails closed.
- Audit of issuance, denied credential attempts and consumption includes actor/branch/action/resource/method, **never passwords, OTPs or token plaintext**. Existing clinical/financial audit rows reference the consumed grant UUID.
- No grant can be silently carried from another branch, session, action, result, invoice/payment or discount request.

## Testing gates
- Safety tests: opaque token shape, action/resource binding, replay/CAS proof, mandatory server-side authorization, two-factor verification, redacted audit, all four mutation paths and UI gates.
- Two-connection MariaDB integration: tenant/branch/session isolation, competing claim lock, one-time consumption, permanent audit evidence and multi-session distributed failed-attempt count.
- Full CI exact branch head: migrations, Prisma generate/status, all historical safety/MariaDB suites, TypeScript, lint, RTL/LTR checks, Next production build. Only merge if all pass; independently recheck `main` CI after merge.

## Deployment, security and remaining scope
- Additive migration: `20261012200000_staff_high_risk_step_up`. Back up the Hostinger DB before deploy.
- Uses existing `APP_ENCRYPTION_KEY` for staff TOTP only; strong key must already be configured for MFA-enrolled users. No additional environment variables. The production site must use HTTPS.
- Release testing is automated engineering acceptance; real clinicians/cashiers and provider/security UAT remain deferred per owner agreement.
- Manual/password/TOTP sign-off applies only to the four listed transitions; scope §64 is not considered universal across every future approval flow until those are separately integrated.
- Open Draft PR #128 (Analyzer Bridge) and Draft PR #209 (superseded interpretation draft) remain untouched.
