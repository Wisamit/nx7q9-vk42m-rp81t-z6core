# Family Lab — consolidated inter-branch transfer/order closure

**Baseline:** Owner confirmed successful Hostinger deployment of `025bb3b2185caa6de399b5145048733b1d7849cc`. This bundle addresses a source-confirmed P1 chain-of-custody gap in existing workflows, not a new numbered Stage, feature expansion or a claim of clinical acceptance.

## Defect and safe boundary

- `POST /api/transfers` accepted a `COLLECTED`/`RECEIVED` specimen without checking its parent order's current status. A `CANCELLED` or `COMPLETED` order could acquire a new DRAFT transfer manifest, including when the order closed after the operator rendered the form.
- `POST /api/transfers/[id]/actions` `DISPATCH` claimed a DRAFT manifest and set its specimens `IN_TRANSIT` based on specimen status/version/branch only. An order cancelled between manifest creation and dispatch could still be physically dispatched.
- **Important distinction:** A specimen *already dispatched* must remain eligible for documented destination receipt or controlled exception, even if the clinical order becomes cancelled or completed while physically in transit. Blocking that custody recording would itself be unsafe. Receipt and exception paths are deliberately unchanged.

## Corrections

- Shared tenant-scoped `lockActiveTransferOrders` obtains parent-order `FOR UPDATE` locks in sorted deduplicated order before any new manifest or dispatch mutation. Only `REGISTERED`, `COLLECTED`, `IN_PROGRESS` can authorize *new* shipments.
- Manifest creation checks candidate order eligibility at API boundary and repeats it under ordered transaction locks before locking specimen records, the active-manifest duplication check, creating the manifest and audit.
- Dispatch rechecks every linked parent order under those locks before claiming the DRAFT manifest and transfer items, and additionally matches organization and non-closed parent order in each specimen CAS. On closed order, rollback preserves DRAFT, item and specimen status and does not create a custody/audit event.
- Closed-order rejection is `409 transfer_order_not_active`, rendered with explicit AR/EN guidance without falsely styled success. Conflicts refresh current data without automatic retry.
- Existing branch-scoped permission controls, barcode snapshots, manifest receipt/exception status and quarantine chain-of-custody semantics are unchanged.
- No Prisma schema changes, migrations, dependencies, historical clinical/financial rewrites, rollback, forced pushes or business policy invention.

## Evidence and release gates

- `tests/release-closure-transfer-order-dispatch.test.ts`: directly exercises sorted unique order locks and closed/missing stage rejection, plus source ordering guards and bilingual UI semantics. Keeps already-shipped receipt/exception unblocked.
- `tests/release-closure-transfer-order-dispatch-mariadb.integration.test.ts`: separate real MariaDB connections check that cancellation blocks dispatch while live, a prior cancellation is observed, closed orders do not authorize a new shipment, and after valid dispatch the sample is still receivable into its destination branch when cancellation happens during transit. All fixture data are synthetic and cleaned up.
- Run full existing CI on PR HEAD, then independently on merged main SHA: Prisma, TS, ESLint, clinical/financial/role tests, MariaDB, 88-scope/81-route static audits, AR/EN safety and Next production build. GitHub CI is **not** proof of Hostinger deployment.
- **#265 remains OPEN:** actual private synthetic authenticated interactive 81-screen browser review, contrast/RTL/a11y and role-scoped UI acceptance, not just source inventory.
- **#250 remains OPEN / NO_GO:** 88 field UAT cases, clinical/finance/device/DR approvals, exact legacy MDB reconciliation, analyzer §75, tax/currency §86 and governed §87–88 requirements. No false Production GO or Software RC.
