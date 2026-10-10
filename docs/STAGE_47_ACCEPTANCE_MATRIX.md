# Stage 47 — Organization-Serialized Safe-Master Import Commit

**Baseline:** current `main` `e7c4ecb765d6a7d82be6d5f428e48b5ae31afa17`, successful CI #953. Stage 46 was already independently merged when this work began. Repository verified PUBLIC.

## Master Scope basis and defect
Master Scope §§7–8, 11, 41, 80, 87–88 require stable clinical catalog identities, tenant-safe configuration and governed legacy migration. Safe-master commit previously read the entire validated batch and its staged rows **before** starting its transaction and only claimed the specific batch under transaction. Stage 45 legacy unit materialization takes an organization lock but safe-master commit did not. A second batch or another unit-preparation request could race the first batch, resulting in duplicate alias symbols, non-deterministic default-unit selection or stale source rows, even though identical-batch double submit was prevented.

## Scope of fix
- Acquire an organization-level MariaDB `FOR UPDATE` row lock before catalog-master discovery or mutation. This uses the same organization lock as Stage 45 unit preparation to serialize independently created batches for a tenant.
- Re-read the validated organization-owned batch and its rows **after lock acquisition within the transaction**. Rebuild eligible source-row decisions from current persisted values; fail closed if validation/status or source type changed. Preserve the existing atomic batch `VALIDATED -> IMPORTED` CAS and rollback behavior.
- Reconfirm the active branch belongs to the organization, is active and explicitly granted before any master data writes. No new cross-branch default availability.
- Existing collision-safe unit resolution, exact source-row panel binding, existing clinical definition matching, immutable histories, financial exclusion and complete audit remain unchanged.
- No migration, no clinical range/price activation, no report or invoice mutation.

## Automated acceptance
- `tests/stage-47-safe-master-import-serialization.test.ts`: static ordering and fail-closed contract assertions.
- `tests/stage-47-safe-master-import-serialization-mariadb.integration.test.ts`: two independent MariaDB connections, distinct batches, organization row serialization, a committed changed source row, and a subsequently observed new unit identity; tenant isolation. It exercises persisted transactional primitives/helper logic, not HTTP.
- New database test is mandatory in CI together with all earlier integration suites, safety tests, Prisma, typecheck, lint, i18n/theme and Next production build.

## Deferred
This does **not** turn Stage 46 review-only configuration bundles into restorable imports. It also does not claim all standalone catalog CRUD endpoints take this lock. Full 88-section Master Scope remains active. Analyzer Bridge PR #128 remains independent Draft. Manual clinical and financial acceptance, analyzer/scanner/printer UAT, provider testing, restore demonstration and comprehensive end-to-end UAT remain DEFERRED until all implementation is complete.
