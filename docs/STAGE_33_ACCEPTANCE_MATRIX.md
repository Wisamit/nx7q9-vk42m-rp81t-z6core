# Stage 33 — Branch/Department Safe Component Reconciliation

Base: `dbc742850999bb5faba7b1d5ea2e59c8395cf937` (Stage 32 exact-main CI #913 SUCCESS).

## Audited defect

The read-only component reconciliation endpoint previously resolved parent LabTest codes using organization-only filtering. Restricted department/branch reviewers could infer identities of off-scope test definitions and receive `READY_FOR_GOVERNANCE` for a test outside their clinical access scope.

## Change

- Require an ACTIVE, explicit current branch session using `resolveClinicalImportScope`, before reading staged candidate rows.
- Load matching parent tests with `clinicalImportTestWhere(scope)`, which enforces organization, active test, allowed departments, active department and current/global department branch.
- Out-of-scope test codes are unresolved, producing `PARENT_TEST_NOT_ACTIVE_OR_MISSING` and `BLOCKED` without revealing internal parent IDs.
- Preserve the endpoint's 100-row pagination, batch tenant check, whole-batch duplicate detection, existing unit rules, audit and `liveWrites:false`.
- Add source-contract and two-session MariaDB tests for two tenant organizations, separate branches and departments; include in CI.

## Limits

- This closes the test-resolution authorization gap, not the future governed component-import/approval workflow. **No clinical master/component or released result change** is performed.
- Authorized catalog managers still see source candidate codes in the staging batch by the existing catalog review rules. Per-source batch classification and approvals remain separate tasks.
- No schema migrations. All 88 Master Scope sections remain binding; Analyzer Bridge PR #128 stays independently Draft/unmerged. Hostinger deployment and clinical UAT are separate owner decisions.
