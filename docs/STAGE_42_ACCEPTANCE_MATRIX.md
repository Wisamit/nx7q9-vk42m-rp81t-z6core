# Stage 42 — Clinical Test Scope Safety in Staged Price Reviews

**Baseline:** Stage 41 owner-verified on Hostinger. Exact merged `main` `a09fdb4040863f2203202fb31e29126affc97f63`; CI #936 SUCCESS.

## Observed gap

Generic staged price reconciliation checked price-list organization/branch scope and `pricing.manage` + `catalog.manage`, but its LabTest lookup previously used `departmentId IN granted active departments` only when the filtered grant list was non-empty. A user whose only department grants were inactive, foreign branch or invalid would therefore match tests across the **entire organization**, bypassing branch/department restrictions. A matched list also permitted echoing a staged candidate's amount, test code and source issue metadata even where the test identity was outside the user's active clinical scope. The import-batch detail page exposed normalized staged source values independently of this API.

## Implemented

- Require `resolveClinicalImportScope` in read-only price reconciliation, before loading any staged finance candidates. A missing, inactive, foreign or ungranted active branch, or an exclusively invalid set of department grants, returns 403 without widening scope.
- Resolve price-linked LabTests using `clinicalImportTestWhere(scope)` (active organization, current branch, active department and granted department limits), not an optional `departments.length` filter. Preserve the explicit authorized active-branch list scope from Stage 40.
- If the price list is permitted but the referenced test is not accessible, return a `TEST_SCOPE_UNRESOLVED` blocked placeholder with no price amount, currency, test/list codes, dates, staged source issues or resolved identifiers.
- The batch detail page applies matching clinical scope and test-code authorization **before** loading raw normalized rows, issue summaries or detailed financial source. Until a dedicated governed unresolved-mapping workflow exists, a batch containing unmapped/inaccessible price test identities is not exposed by the generic batch detail route (404).
- The client parser rejects any leaked amount/currency/identity from a `TEST_SCOPE_UNRESOLVED` placeholder. Show an Arabic/English label for the blocked row.
- Added deterministic source/permission/redaction tests plus two-session MariaDB regression (multiple branches, departments, tenant boundaries and read-only financial state), and wired it into CI.

## Explicit safety constraints

No price-list writes or approvals, invoice, currency conversion, contract/client pricing, reference interval, specimen, patient or released result change. Price candidates remain **review-only**, with live pricing governance and unresolved-code review reserved for later scope. No migrations. All 88 sections of `02_MASTER_SCOPE.md` remain in the target, including clinical/financial UAT, comprehensive import/export and legacy Access fidelity; none is removed. Analyzer Bridge PR #128 remains Draft/unmerged.

Acceptance requires exact final feature SHA CI and exact merged main SHA CI, including Prisma status, safety, two-session MariaDB, types, lint, locale/theme and production build. This does not prove Hostinger deployed successfully: deployment and manual clinical/financial/branch UAT remain independently owner verified/deferred until the complete implementation.
