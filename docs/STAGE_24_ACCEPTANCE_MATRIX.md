# Stage 24 — Controlled Catalog Configuration Export and Review-Only Staging

**Base main:** `4b5a36d7ff1cf8c069b807b0b4e4946b42679a9d` (Stage 23, CI #882 SUCCESS and Hostinger deployment owner-confirmed).

## Existing capability audit and increment

The system already has configured test and component entry, unit masters, versioned/effective-dated clinical reference intervals with draft/approval/retirement, price lists and price items, catalog imports for TEST/PANEL/UNIT/CONTAINER and a separate reference-range mapping/import route. Existing safe master import intentionally does **not** create or mutate prices and test components.

**New:** bilingual catalog-page JSON export and protected `GET /api/catalog/configuration-export?entityType=...&cursor=...` for six configuration classes:
`TEST`, `COMPONENT`, `UNIT`, `REFERENCE_INTERVAL`, `PRICE_LIST`, `PRICE_LIST_ITEM`.

### Scope and fidelity

- **Authorization:** active session with `catalog.manage`; financial categories additionally require `pricing.manage`. No export if the user has zero active branch scopes. Price lists and items with a specific branch are included **only** if that branch is within the user's active branch scopes; organization-global price lists are allowed. Reference intervals are similarly branch filtered. Test and component information is tenant-scoped and respects explicit department scopes.
- All exports are read-only for configuration and historical lab/financial content; original UUIDs, codes, Arabic/English fields, current/inactive status, approval status, effective/retirement dates, branch/method/analyzer context, original currency and exact `Decimal` strings are serialized without floating-point conversion.
- Each API read uses deterministic **ID keyset pagination** with a 250-record displayed page, 251st lookahead, and strict UUID cursor validation. A deleted or cross-organization cursor cannot authorize a row. API returns `nextCursor` / `hasMore`; results are `private, no-store`. Audit event `CATALOG_CONFIGURATION_EXPORTED` records each scoped read, not individual protected values.
- Browser client requests pages serially per selected category and writes a **single JSON bundle** only after all pages succeed. It fails instead of saving a partial file, with a 200-page-per-category safety limit. Records may change during the export: the manifest explicitly says `consistency: paged-live-not-atomic`. **This is NOT a transactional backup** or a guaranteed fixed-time snapshot.

### Safe import expansion

- Incoming `COMPONENT` and `PRICE_LIST_ITEM` rows are **accepted into staging only**. They are normalized with identifiers and mapping fields; missing parent/test/price-list codes, invalid decimal price and ambiguous effective-date windows produce row errors.
- All otherwise valid new-entity rows still get an explicit `WARNING` (mapping and approval required). They cannot enter the existing master-data safe-commit allowlist, which remains **only TEST, PANEL, UNIT and CONTAINER**. Existing reference-interval import governance remains separate.
- Batch/row source JSON, normalized previews, issues, provenance and deferred row counts are retained; the review UI identifies these new classes as **review only**. Committing other safe master rows cannot create a component or alter any current/historical price.
- Invalid null or array objects are rejected before staging.

### Test coverage

- `tests/stage-24-catalog-configuration.test.ts` validates allowlisted categories, strict cursor parsing, fidelity/provenance, stage-only validation, malformed financial inputs, exact safe-commit guard and auth/scoped export source checks.
- `tests/stage-24-catalog-export-mariadb.integration.test.ts`: independent MariaDB connections, multiple organizations and branches, 252 effective-dated prices for the **250+1+2** page boundary, exact four-decimal prices, out-of-branch/foreign price exclusion, and approved six-decimal clinical reference intervals.
- GitHub Actions CI checks this MariaDB integration plus earlier stage tests, full safety suite, Prisma migrations, TypeScript, ESLint, bilingual UI checks and production Next.js build.

## Explicit remaining work

- This stage intentionally does **not** auto-import component definitions or prices. Full governed import with mapping, conflict detection, immutable price versioning and approval flows is still required by `02_MASTER_SCOPE.md`, as are terminology mapping, broader legacy data sources, and completely replayable managed import/export.
- Exported JSON data does not itself constitute a restore or re-import protocol. Full backup/recovery UAT and clinical/financial acceptance are not completed.
- Analyzer Bridge PR #128 remains open Draft/unmerged.
- The full 88-section master scope is unchanged. Manual, device and end-to-end UAT stay deferred until the LIS is built. Hostinger deployment is owner-confirmed **after**, and independently of, exact-main CI SUCCESS.
