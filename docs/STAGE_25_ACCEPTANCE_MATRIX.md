# Stage 25 — Component Import Reconciliation (Read-Only Governance Preparation)

**Baseline:** `a2409b8818a5f16ae594e20419d9bdb0e50226d0` (Stage 24 merged / main CI #885 SUCCESS, but independent Hostinger deployment of Stage 24 not confirmed by owner).

## Audit

Stage 24 added tenant/branch-scoped catalog configuration export and deliberately review-only `COMPONENT` and `PRICE_LIST_ITEM` staging. The safe commit allowlist remains limited to `TEST`, `PANEL`, `UNIT`, `CONTAINER`. This stage introduces a **read-only mapping reconciliation** step for staged `COMPONENT` rows; it is not authorization to create clinical component definitions.

## Implemented

- New protected `GET /api/catalog/imports/[id]/components/reconcile?after=<rowNumber>` with `catalog.manage` and batch organization authorization, `Cache-Control: private, no-store`, and audit action `CATALOG_COMPONENT_IMPORT_RECONCILED` recording only counts.
- Bounded 100-row response, 101st sentinel and validated numeric cursor. Matches the staged normalized component's parent test by exact code inside the current organization, reference unit inside the current organization and its live enum result type.
- Blocks missing/inactive parents/units, pre-existing component codes within the selected test, repeated staged component code across the **whole batch**, malformed staged rows, imported/skipped rows, and unsupported result types.
- A matching component is marked `READY_FOR_GOVERNANCE`, **not** `APPROVED` or `IMPORTED`; the API is read-only for clinical master data and never modifies historical results, reference intervals, templates, or prices.
- Added an Arabic/English review table on the existing import-batch page, with explicit warning and manual continuation per 100 rows. Existing staged raw source and warning records remain preserved unchanged.
- New deterministic tests and real two-connection MariaDB regression for 102-row page boundaries, duplicate staged codes, existing component collision, foreign-tenant staging, exact test/unit matching. CI runs alongside existing comprehensive integration and safety checks.

## Still required

- A deliberately separate **governed clinical component import commit** with explicit approval, rollback strategy, conflict/no-overwrite semantics and method-specific clinical sign-off is not in this stage; no implied approval is permitted from read-only reconciliation.
- Price-list-item import, reference interval and terminology synchronization, legacy Access full fidelity and clinical UAT remain planned, and the 88 sections of `02_MASTER_SCOPE.md` remain in scope.
- Analyzer Bridge PR #128 remains Draft/unmerged.
- Manual browser, physical analyzer, clinical and complete UAT deferred until the whole project is implemented. Hostinger deployment status must be confirmed by the owner independently of GitHub CI.
