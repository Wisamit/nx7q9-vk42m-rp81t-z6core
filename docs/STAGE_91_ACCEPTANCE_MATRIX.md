# Stage 91 — Doctor Portal Patient Authorization and Clinical Disclosure Governance

## Major capability
Master Scope §47 requires a physician portal restricted to authorized/referral patients. Existing portal pages showed all orders and report versions tied to a referrer's ID, without explicit patient-level authorization or revocation. This stage closes that gap as an end-to-end access governance module.

- Version-safe additive `DoctorPortalPatientAccess` model with tenant, physician, patient, independent order/report flags, effective dates, reason, creator and revocation evidence. No clinical report or historical order data overwritten.
- Reusable fail-closed `doctorAccessWhere` predicate limits doctor orders and report listings by tenant, referrer, active patient grant and effective time; direct report-version access checks the same predicate. Patient and corporate portal policy unchanged. Retracted report safeguards retained.
- Protected `/doctor-portal-access` bilingual governance screen, linked from Digital Services, to grant per-patient access to active physician portal accounts and revoke it with a mandatory reason. Backend uses `portal_accounts.manage`, active branch scope, tenant checks, current active physician/patient, Serializable locks, unique active-pair semantics, and immutable audits.
- Revocation immediately disables future portal access while preserving audit and original grant reason. Distinct order versus report capabilities prevent inadvertent release of medical values merely because orders were visible.

## Clinical rollout
Doctor portal disclosure is **fail-closed**. Existing physician accounts require explicit patient grants after the migration before any orders or reports appear. This may change previous doctor access behavior; clinical staff should populate authorizations in line with organizational consent and disclosure policy. No automatic permission backfill from historic referrals. Physician electronic order entry is a separate future feature.

## Verification / deployment
- Node safety tests check exact organization/referrer/effective-date predicates, independent capabilities, detailed report protection, scope and audit guardrails.
- Real two-connection MariaDB tests check cross-organization patient isolation, separate report/order rights, expiry, concurrent row locks, immediate revocation and audit.
- Requires additive `20261012170000_doctor_portal_patient_access` migration; backup Hostinger DB before deployment, apply `prisma migrate deploy`. No environment variables added.
- CI must pass schema migrate/status, all safety/real MariaDB tests, TypeScript, ESLint, RTL/LTR, Next build on exact feature and merged main SHA. This does not substitute clinical/legal authorization review.
- Do not merge or change Analyzer Bridge PR #128. Stage 90 EQA remains part of main and is unrelated to this new module.
