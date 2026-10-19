# Family Lab — consolidated clinical order/result integrity closure (2026-10-19)

**Owner-confirmed Hostinger baseline:** `638797cf870b0e13e5c2103538993ec92b6fa3bc`, after previous send-out P1 closure. This bundle is a narrow **clinical safety bug fix**, not a new feature stage. Master Scope all 88 sections preserved.

## Source-reproduced problem

A result-entry request could be prepared against an order/test which was subsequently cancelled. The `POST /api/results` path checked specimen custody and existing result stage but, before this fix, neither order cancellation nor item cancellation was an authoritative commit-time gate. It also used the stale page-loaded order status to emit `REGISTERED/COLLECTED → IN_PROGRESS` history and an unconditional order-item update. The same stale-order/status-pattern existed in technical review `POST /api/results/[id]/verify`, both medical validation outcomes `APPROVE` and `RETURN`, and `POST /api/results/[id]/release`. These paths could advance result status or create report/audit history after an order/test cancellation.

## Safety correction and scope

- `src/lib/result-order-state.ts`: re-usable, tenant-scoped order → order-item InnoDB `FOR UPDATE` locking guard. Rechecks live states **inside the same transaction before clinical writes** and blocks cancelled orders/items. Validates stage-specific state: entry/review require open order with unfinished item; release requires a verified item and active/completed order.
- Result entry, technical review, medical `RETURN` and `APPROVE`, and report release now call the same guard **before** specimen custody and result/version mutation. Any failure rolls back and returns HTTP `409 order_or_test_not_open_for_results`. No audit, report version or clinical value is created by the failed attempt.
- Result entry and final review order progression use a fresh locked state and conditional `updateMany` rather than a stale page-status assumption, preserving exact status-history transitions.
- `result-entry-form` and bulk result UI show bilingual, non-success feedback on an updated/cancelled order.
- Existing technical/medical validation, QC holds, critical-result communication, analyzer provenance, staff reauthentication, reporting version snapshots and branch/department RBAC stay unchanged.
- No Prisma schema/migrations, dependencies, patient data, result values, clinical thresholds, reports, pricing, database rollback or force push.

## Regressions and confidence boundary

- `tests/release-closure-result-order-guard.test.ts`: confirms the shared order/item guard precedes specimen/result writes across entry, technical, both medical actions and release, plus status-history consistency and the bilingual conflict feedback.
- `tests/release-closure-result-order-lock-mariadb.integration.test.ts`: real three-connection MariaDB synthetic-fixture checks order cancellation waits on row locks, stale writers see committed cancelled state, cancelled order items are rejected and conflicting transactions cannot interleave. This test validates the database isolation primitive, not authenticated end-to-end UI flows.
- On final PR HEAD and independent merged main SHA require TypeScript, ESLint, Prisma migrate/generate/status, safety/clinical/financial and integration tests, 88-scope/81-route source audit, AR/EN theme checks and Next production build. GitHub CI never substitutes for a fresh owner-confirmed Hostinger deployment.

## Explicit release gates, not falsely closed

- 88 Master Scope sections have source inventory but not complete professional signoffs.
- 81 screens have source review inventory, **not** private interactive screenshot/a11y/RTL/theme/branch review. Public GitHub repo must not upload patient or privileged screenshots; separate synthetic staging browser is required. Issue **#265 stays OPEN**.
- Physical clinical/finance/device/DR UAT, exact legacy MDB parity, §75 analyzer-specific clinical policy, §86 tax/currency approval, §87 governed spreadsheet activation and §88 expert row reconciliation remain **NOT_EXECUTED/NO_GO** where applicable. Issue **#250 stays OPEN**.
- This build is a software defect remediation candidate, **not** Software RC or clinical Production GO.
