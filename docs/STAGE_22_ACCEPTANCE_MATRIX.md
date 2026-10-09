# Stage 22 — Aliquot Concurrent-State Integrity

**Base:** `76497be7aa2f4c1c8fc4fe3cb2ec21130e8b1c77` (Stage 21, CI #876 SUCCESS and owner-confirmed Hostinger deployment).

## Master Scope review

The current codebase **already implements** an aliquot lifecycle (parent/child specimen lineage, barcodes, specimen/test links, physical storage location, volume reconciliation/consumption, traceable usage event and audit), plus specialized configuration-driven result sections, grid layout and technical/medical validation foundations. The older `docs/MASTER_SCOPE_COMPLETION_AUDIT.md` predates those features and must not be interpreted as evidence that all are missing.

**Stage 22 is an incremental safety hardening**, not a claim that every specialized workflow or aliquot/device clinical use case is finished.

## Implemented safety increment

1. The aliquot creation transaction now acquires a **current `orders` row lock** and refuses an order that became `CANCELLED` or `COMPLETED` since the initial request lookup. The atomic parent-volume mutation repeats the organization-scoped active-order check.
2. When order items are explicitly selected, the transaction acquires **locking reads for every selected `specimen_order_items` / `order_items` association** and verifies the parent, active link, non-cancelled item and correct order. Rejects any missing/ineligible entry before consumption; no partial allocation of a subset is allowed.
3. When an override container is requested, obtains an active, organization-scoped `containers` row lock. Deactivation during the request cannot commit a child referencing a newly inactive selected container.
4. The existing location lock is preserved; its lock precedes order/association/container checks, followed by version-protected parent-volume consumption. The child, child-to-test bindings, specimen events, usage ledger and audit remain in **the same Prisma transaction**. Failure rolls back all mutations.
5. New failures return specific HTTP 409 errors and the component displays bilingual stale-container feedback. No released clinical/financial records are modified; no schema migration.

## CI and engineering acceptance

- `tests/stage-22-aliquot-concurrency.test.ts` validates lock order, state predicates, per-test completeness, current-container status and atomic lineage/audit operations.
- `tests/stage-22-aliquot-mariadb.integration.test.ts` uses **two real MariaDB connections** to prove tenant/branch-scoped fixtures, committed order closure, rejected specimen-test association and deactivated container are rejected without volume loss; a competing writer lock blocks selection until resolved; a successful guarded specimen-volume update rolled back returns the original balance.
- CI runs all prior safety and live MariaDB suites, Stage 22 MariaDB, Prisma migration/generation, TypeScript, ESLint, bilingual UI checks and Next build.

## Remaining and exclusions

- Individual analyzer and specialized result workflows still require catalog/equipment-specific acceptance. Do not assert that all clinical result-entry variations are fully covered by configurable sections.
- Physical bench specimen processing, aliquot label handling and inter-branch transfers require **final end-to-end clinical/device UAT**, explicitly deferred until full system implementation.
- The Analyzer Bridge PR #128 is still Draft and unmerged; nothing from it is included.
- Master Scope §§1–88 remains authoritative. This increment removes no features.
- Hostinger deployment cannot be inferred from merge or green CI; the owner will separately confirm release of the exact `main` SHA.
- All manual browser, device, clinical and go-live UAT is **DEFERRED**, not passed or waived.
