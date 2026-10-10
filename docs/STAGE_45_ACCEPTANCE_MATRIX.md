# Stage 45 — Legacy Unit Preparation Identity and Concurrent Write Safety

**Baseline:** Stage 44 main `e7c3452c9a6de1e9c8438880a1d4eb487a8ca428`, CI #943 SUCCESS, Hostinger deployment owner-confirmed. GitHub repository was verified PUBLIC before writing.

## Reviewed defect and scope

Master Scope §§7–8, 11, 41, 63, 80, 87–88 require safe master data, immutable clinical provenance, tenant/branch/department permissions and audited controlled legacy migration. Stage 44 secured the **safe-master commit** unit binding. A different legacy action, `POST /api/catalog/imports/[id]/prepare-units`, still resolved code/symbol aliases by last-write-wins `Map.set`, including inactive units, and could assign a test's default unit from a different unit identity based on unpredictable DB enumeration order. Nonempty old source unit text could be silently truncated to 50 characters. Unit discovery and creation happened outside the database transaction: parallel requests could independently create duplicate-symbol units, and prepared source rows could change between initial read and clinical writes. Any TEST row with `importedEntityId`, including `SKIPPED` or `ERROR`, could supply a unit source.

## Implemented narrow fix

- `src/lib/catalog-legacy-unit-preparation.ts` isolates the pre-existing conservative legacy unit alias normalization without implying measurement conversion. It builds conflict-sticky, order-independent normalized code/symbol maps; both duplicate aliases and inactive masters become non-resolvable. Legitimate exact matches remain allowed.
- Reject creation when raw unit symbols or derived codes cannot fit the full database identifier lengths, rather than truncating. Generated codes with conflicting aliases use a bounded, unique suffix only if the full generated code fits. Existing unit masters, status and historical test data are never rewritten.
- Source inputs are limited to **IMPORTED** TEST rows with an imported target ID and **VALID/WARNING, not already imported** REFERENCE_INTERVAL rows. Processed, skipped, failed and forged source claims are excluded.
- Re-read current source rows, authorized scoped tests and organization-owned units **inside the same transaction**, after locking the organization row and the specific import batch. This serializes concurrent preparation requests from multiple legacy batches in the same organization and ensures current state is used for materialization. It does not pretend that unrelated unit CRUD endpoints participate in this lock.
- Recheck active branch and imported test department/branch authority within the transaction. Assignment uses a scoped, active, `defaultUnitId: null` optimistic `updateMany` to prevent overwriting an existing unit definition. Unresolved unit aliases leave test definitions untouched and remain reviewable.
- Preserve established authorization `catalog.reference_ranges.manage` and `resolveClinicalImportScope`. Audit counts now disclose ambiguous/unrepresentable source units and unresolved test assignments without patient/clinical values. No migration.

## Automated checks

- Deterministic `tests/stage-45-legacy-unit-preparation.test.ts`: reverse-order alias conflicts, inactive status, unknown keys, no truncated identities, source row status/provenance eligibility, transaction lock ordering, CAS/tenant/branch route guards.
- Real MariaDB integration `tests/stage-45-legacy-unit-preparation-mariadb.integration.test.ts`: two independent connections, source rows and test IDs, multiple branches/departments and a second tenant, colliding symbols and inactive masters, excluded forged/failed rows, concurrent serialization by organization lock, one new unit, stable foreign/off-scope records, and replay-safe test default-unit CAS. It validates database behavior and helper composition rather than an authenticated HTTP request.
- New MariaDB test added to `.github/workflows/ci.yml`; existing Stage 31, Stage 43/44, finance, clinical, Prisma, TypeScript, ESLint, UI bilingual/theme and Next.js checks remain mandatory on the exact final PR and merged-main SHA.

## Explicit limitations

The action still prepares **configuration candidates** and legacy units under pre-existing permissions; this stage does **not** create or approve reference intervals, perform reference-unit conversions, activate price lists, issue new patient reports, or attest clinical equivalence. No historical reports/invoices, released clinical values, existing unit master IDs or source import provenance are destroyed. Other direct catalog CRUD routes that do not share the organization lock require separate concurrency controls. Full MDB mappings and controlled clinical approval are still open Master Scope requirements, not removed.

All **88 Master Scope sections remain in scope**. Analyzer Bridge PR #128 remains Draft and separate. **Manual clinical/financial, scanner/printer/analyzer, inter-branch and entire-system UAT remains DEFERRED until all implementation is finished**, not passed or waived. Hostinger deployment requires the owner's independent confirmation after main CI success.
