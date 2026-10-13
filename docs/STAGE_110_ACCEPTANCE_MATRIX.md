# Stage 110 — High-risk electronic approval coverage

## Verified authority and gap

- Base main SHA: ef621c855f0347fee65fc6bcb1572e997d1cb56e, Stage 109, owner-confirmed successful Hostinger deployment; main CI #1213 SUCCESS.
- Master Scope §64 Electronic approval/signature, §§3–4 patient identity, §§16–19 billing, §§38–41 results/amendment/audit, §79 security and §80 historical integrity.
- Existing Stage 96 staff step-up protects medical validation, result release, discount approval and refund posting. The live base routes for patient merge, released-result amendment and credit-note issuance did not require it.
- Stage 110 uses the existing database-backed 2-minute, one-time, user/session/tenant/branch-scoped password + configured TOTP proof mechanism. No new schema migration or credentials.

## Server-enforced workflows

1. Patient merge requires PATIENT_MERGE scoped to the exact source-patient and target-patient ID pair, in that direction. Proof is consumed inside the existing serializable transaction after tenant/eligibility checks and before mutating aliases or identity/audit state.
2. Released result amendments require RESULT_AMEND scoped to the exact original released-result ID and performing branch. The original released row is locked, concurrent newer results rechecked, and the proof consumed atomically before creating a draft amendment. Original released values and historical report versions remain unchanged.
3. Credit-note posting requires CREDIT_NOTE_ISSUE scoped to invoice ID and exact decimal amount, with the invoice branch. Existing amount policy, line-by-line tax reversal, CAS invoice update, credit-note ledger snapshots and audit remain authoritative. Concurrent CAS conflict throws and rolls back any consumed proof.
4. UI in Arabic and English captures direction, reason, and amount, and invokes existing StaffStepUpDialog before posting. Direct API calls without a matching proof fail closed.
5. Audit links include step-up grant ID and proof method; no password, token, TOTP or session secret is recorded in the action audit payload.

## Tests and operational boundaries

- Static/action safety tests assert exact resource grammars; mutation-before-proof is forbidden; cross-action or reversed merge proofs cannot transfer.
- Real MariaDB dual-session integration checks all three new actions against cross-user-session, cross-tenant, cross-branch, changed resource, expired/consumed and concurrent replay, alongside existing Stage 96 tests.
- CI: full existing safety and MariaDB suite, Prisma migration status, TypeScript, lint, i18n/theme and Next production build.
- Real credential flows, physical user UAT, clinical/financial review, security testing and disaster recovery acceptance remain DEFERRED by owner until complete LIS acceptance.
- No external providers are enabled, no clinical result is released or automatically approved, and no historical patient, financial or report snapshot is rewritten.

## Release gate

- [ ] Feature branch exact-head CI SUCCESS
- [ ] Ready PR, exact-head merge
- [ ] Independent main CI SUCCESS at merge SHA
- [ ] Owner-managed Hostinger deployment and confirmation
- [ ] Manual/clinical/financial/infrastructure acceptance DEFERRED, NOT PASSED
