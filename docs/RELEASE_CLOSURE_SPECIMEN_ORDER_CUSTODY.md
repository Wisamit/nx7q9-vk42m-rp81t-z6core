# Family Lab LIS — consolidated specimen order-state closure (2026-10-19)

**Hostinger owner-confirmed baseline:** `e429df5fc581c46b7557f4b2b636a19b1f253978`. This release-closure bundle addresses verified existing P1 safety gaps; no new product features and no numbered Stage.

## Evidence and risk

- `src/app/api/specimens/[id]/actions/route.ts`: local branch reception and negative reception/quarantine checked physical branch, specimen status and preanalytical version, but did **not** check the specimen's order was still active. An operator using a stale specimen page could mark a sample `RECEIVED` (or newly `QUARANTINED`) after another operator cancelled/completed the order.
- `src/app/api/specimens/[id]/volume-reconcile/route.ts`: similarly allowed editing remaining specimen material when its parent order was `CANCELLED` or `COMPLETED`. Other existing pathways (collection attempts, specimen usage, aliquoting, targeted rejection) already fail closed for these order states. This closes that inconsistency, without modifying existing preserved historical amounts.
- The specimen and aliquot UI displayed some rejection errors in green success styling; a 409 could be mistaken as a successful receipt/volume adjustment.

## Implemented corrections

- New `src/lib/specimen-order-activity.ts` uses tenant-scoped `SELECT status FROM orders ... FOR UPDATE` inside the same Prisma transaction, before the specimen CAS and event/audit writes. Only `REGISTERED`, `COLLECTED`, `IN_PROGRESS` are eligible for these *new* operational actions; cancelled and completed orders are not.
- Both `RECEIVE` and the quality-exception `QUARANTINED` path call this guard; their CAS includes a parent-order status predicate. Rejections return `409 specimen_order_not_active` and do not create a receipt, acceptance, quarantine or audit event when the order is closed. Stale specimen version during reception now yields 409 rather than an uncaught internal error.
- Volume reconciliation uses the same lock plus version and order-state predicates; keeps all original exact volume math, usage floor enforcement, and immutable event/audit snapshots.
- Arabic and English UI errors are explained and rendered with error/alert semantics, never success styling. On an explicit 409, refresh current page data; do not automatically retry an ambiguous request.
- Existing barcode manifest creation, source dispatch, destination receipt and exception custody workflows are unchanged; review found their existing lock/CAS protection. Inter-branch physical transfer should not be forced through local branch reception.
- No migrations, new DB tables, schema, dependencies, historical rewrites, clinical thresholds, financial changes, or forced production rollback.

## Tests and release gates

- Source/runtime regression: `tests/release-closure-specimen-order-guard.test.ts`; executes active/closed/unknown order status policy directly, confirms both reception pathways and volume writes are guarded before mutation, bilingual error feedback.
- MariaDB integration: `tests/release-closure-specimen-order-guard-mariadb.integration.test.ts`; isolated synthetic organization/branch/patient/order/specimen with three DB sessions, real row contention, cancellation/completion rejection and clean exit. This tests concurrency and database primitives; it is not a substitute for authenticated browser UAT.
- Full CI including TypeScript, Prisma, safety regression suite, legacy clinical/financial tests, 88-scope/81-screen source manifests and Next production build must pass independently on PR HEAD and merged main SHA.
- Hostinger success requires separate **owner confirmation of exact SHA** after merge.

## Non-negotiable acceptance boundaries

- Issue #265 remains **OPEN** for actual private synthetic authenticated browser review of 81 screens (roles, AR/EN/RTL/LTR, dates, responsive, interactions).
- Issue #250 remains **OPEN / NO_GO** for 88 real-world UAT cases and independent clinical, financial, analyzer/device, DR and quality approvals, plus expert legacy MDB parity and explicitly governed §§75, 86, 87, 88.
- Automated source anchors do not equal sign-offs. A successful GitHub CI does not prove Hostinger deployment, clinical Production GO, or full Software RC.
