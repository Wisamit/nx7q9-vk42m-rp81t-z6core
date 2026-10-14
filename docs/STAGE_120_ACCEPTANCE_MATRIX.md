# Stage 120 — Clinical Rule High-Risk Reauthentication and Reflex Decision Fencing

## Baseline and verified gap
- Base: latest independent SUCCESS main CI #1257 at Stage 119 `14bd8990f5ddd0a940f7ed2224161068c1f86ffe`; owner confirmed Hostinger deployment.
- Master Scope §§10, 38–40, 41, 63–64, 75, 79–80. No scope removal.
- Existing rule classes, versioned rule governance, audit, QC/autoverification gating and one-use password/TOTP step-up are **already implemented**. This stage does not rebuild these domains or invent medical thresholds.
- Verified gap #1: `clinical-rules/governance` activated or retired all seven clinical-rule types with only session permission + browser confirmation. It did not consume a fresh action- and rule-bound step-up grant.
- Verified gap #2: reflex recommendation review read `PENDING` before its transaction and then used an unconditional `update`. Concurrent ACK/DISMISS requests could overwrite each other's decision and write contradictory audit events.

## Delivered
1. Two step-up actions `CLINICAL_RULE_APPROVE` and `CLINICAL_RULE_RETIRE`, both requiring `clinical_rules.approve`; token resource strictly uses `ruleType:uuid`. Proof is session, organization, branch, actor, action and exact rule bound, expires after the existing two-minute policy and is consumed once. An approval grant cannot be borrowed for retirement, another clinical rule/type or another branch.
2. Rule governance requires selected active branch for every approval/retirement; branch-specific rules must match selected branch. Live user status, current approver role grants, authorized branch and active session are checked inside the governance transaction before proof consumption and before any rule version update. On errors, proof consumption rolls back with the mutation.
3. The existing Arabic/English `StaffStepUpDialog` is reused by the rule governance UI; current password and TOTP when enabled are needed. A regular browser confirm alone no longer activates/retire a clinical rule. Source text never stores tokens or passwords in browser storage.
4. Clinical rule approval/retirement Audit carries `stepUpGrantId` and `stepUpProofMethod`, retaining existing version succession and effective windows. No released clinical result/report or invoice snapshot is mutated.
5. Reflex ACK/DISMISS rechecks live reviewer role, tenant/branch authority and department grants in the mutation transaction. It uses a conditional `PENDING` → requested state `updateMany` with single-winner claim, returning 409 for a stale second reviewer; only the winning request creates an audit event.
6. No schema migration. The existing controlled reflex workflow **still only records a recommendation**, and never automatically adds a test, releases a result or bills the patient.
7. Regression tests: `tests/stage-120-clinical-approval-reflex-safety.test.ts` covers precise grants, frontend proof dialog, claim order, and existing autoverification QC/delta/reflex/hold/critical gates. Real `tests/stage-120-clinical-governance-reflex-mariadb.integration.test.ts` covers session/branch/type/resource proof isolation, one-time consumption and opposing concurrent ACK/DISMISS with one audit winner; integrated into CI.

## Boundaries and UAT
- Approval of actual clinical rules or medical thresholds requires qualified lab sign-off; this stage does **not** activate sample rules, define clinical limits or perform real clinical UAT.
- Other high-risk actions should be evaluated separately; we do not claim every clinical or QMS approval is signed after Stage 120.
- Patient/clinical/manual/device/analyzer and recovery tests remain deferred to end of build, not cancelled.
- Draft PR #128 and #209 untouched. No Vercel; owner deploys to Hostinger only after exact feature CI and independent merged-main CI pass.

## Release checks
- [ ] Exact feature HEAD SUCCESS: Safety, MariaDB, TypeScript, ESLint, AR/EN, Next production build
- [ ] Draft PR ready and merged with expected_head_sha
- [ ] Independent main CI SUCCESS on merge SHA
- [ ] Owner publishes and confirms Hostinger SHA
