# Stage 31 — Branch / Department Guardrails for Clinical Legacy Imports

**Base main:** `7633321cfbd4c5fd343fd8d7f611c2dc8b56c45a` (Stage 30 merged, exact-main CI #906 SUCCESS, Hostinger owner-confirmed).

## Audited gap

Prior to this stage, the legacy reference-range preview/POST used organization-wide `labTest.findMany` even for department-restricted staff, and had no active-branch guard. Legacy unit preparation could attach units to an imported test in another operational branch, and TEST_ALIAS mapping accepted any test from the organization. These routes were individually permission-gated but lacked branch and department evaluation. The consequences are potential cross-branch clinical configuration access and modification.

## New safeguards

- `src/lib/catalog-clinical-import-scope.ts` validates the session's **active** branch belongs to the current organization, has ACTIVE status and is explicitly in the user's active branch grants; no branch scope, stale active branch, or cross-tenant branch fails closed (403).
- Existing policy is preserved: **zero department grants** means unfiltered department access (still branch-limited); with department grants, only currently ACTIVE departments belonging to the organization and either global or assigned to the current branch are permitted. Inactive or other-branch department grants do not extend access.
- `clinicalImportTestWhere` restricts test reads to current organization, ACTIVE tests, permitted departments, and global/current-branch departments. Deactivated tests and out-of-branch test candidates cannot appear as eligible preview options or aliases.
- Legacy reference-range GET and POST use the same scope and filtered test catalog. The POST also queries the current scoped/active `LabTest` **inside the transaction before the staged clinical row is claimed**, aborting all clinical writes if a test has moved outside scope. Staged row atomic claims and inactive/draft clinical intervals from Stage 30 remain unchanged.
- `prepare-units` validates **all already-imported TEST IDs** in the batch are currently scoped and active before any new unit creation; its test-default-unit updates recheck scope inside the transaction.
- `mappings` requires an authorized active branch, and any TEST_ALIAS target must resolve to a currently ACTIVE, authorized branch/department test. Existing global UNIT_ALIAS policy is preserved but now requires a valid branch session as well.
- Automated tests cover active branch, org ownership, department grants, inactive/foreign department, preview filtering and transaction-time guard placement. Real two-connection MariaDB integration seeds two tenants, multiple branches/departments/tests and proves scoped read exclusion. CI includes the new integration script.

## Deliberate limits

- No new clinical result-release, price/import authorization, range approval, historical-value mutation or new table/migration. Reference ranges remain **INACTIVE/DRAFT** pending formal clinical approval.
- Source data rows may include legacy references to out-of-scope tests; this stage prevents them resolving as live catalog tests. Raw unmatched legacy source names can still be visible to authorized import reviewers; a full per-source batch confidentiality workflow is a separate control.
- Unit definitions and reviewed alias mappings are organization-wide, and their cross-branch governance (dual approvals and scoping of source batches) remains explicit outstanding scope. The import writer cannot modify off-scope imported test defaults through this stage.
- All 88 sections of Master Scope remain binding. Analyzer Bridge PR #128 remains independent Draft/unmerged. CI does not mean clinical or security UAT; manual UI/instrument acceptance remains deferred. Hostinger deployment must be confirmed separately.
