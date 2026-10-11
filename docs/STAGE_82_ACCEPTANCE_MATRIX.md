# Stage 82 — Controlled Legacy Reference Master Data Migration (CSV)

## Baseline and scope gap
- Start point: Stage 81 merged SHA `79816ab9b8aa9170294585fe6dc09abba8600190`, main CI #1062 `SUCCESS`, Hostinger deployment confirmed by owner.
- Authoritative Master Scope §5 (referrers), §6 (order sources), §35 (microbiology organisms and antibiotics), §87 (controlled CSV/Excel import/export), and §88 (legacy MDB master-data migration).
- Earlier controlled catalog imports already cover core tests, components, selected price/range/unit configurations. This stage adds a separate **operator-mapped CSV migration** pathway for formerly uncovered reference masters.
- The cleaned Access MDB is reference material only. This stage does not assume direct live Access connection or migrate patient/transactional histories.

## Delivered capabilities
1. `/catalog/legacy-master-data`, linked from `/catalog`, provides bilingual Arabic/English data-class selection, source label, explicit required header, CSV text, read-only preview, duplicate/conflict list, and a separate confirmation checkbox and commit button.
2. Supported kinds and exact first-row headers:
   - `REFERRER`: `code,name_en,name_ar,type,phone,email,license_number`
   - `SOURCE`: `code,name_en,name_ar,category`
   - `ORGANISM`: `code,name_en,name_ar,category`
   - `ANTIBIOTIC`: `code,name_en,name_ar,drug_class`
3. Parser supports RFC4180 quoted fields, escaped double quotes and multiline cells, UTF-8/BOM, Arabic labels. Validates precise header order, required identity, code alphabet and length, referrer type, source category, email and column limits; fails whole file on invalid input. Up to 200 records / 64 KiB per submission.
4. A `PREVIEW` request computes a stable organization+kind+normalized-rows SHA-256 fingerprint, reports all `NEW` and conflicting existing codes, and performs **no mutations**. Duplicate codes inside the file are rejected before preview; case-normalized matching is enforced.
5. An `APPLY` request must include the same attested fingerprint plus explicit `CREATE_NEW_RECORDS_ONLY` confirmation. It rejects all existing codes, rechecks the live database **inside a SERIALIZABLE transaction**, and inserts all new records with immutable IDs via model-specific `createMany` only. A competing insert or one conflict rolls back the entire batch; no existing codes or names are overwritten or silently skipped.
6. The same transaction creates a grouped import AuditEvent recording sourceName, fingerprint and all new IDs, plus an individual auditable creation event for each record. Existing linked historical orders/cultures and reference values are untouched.
7. `catalog.manage` plus the target-specific permission (`referrers.manage`, `sources.manage`, or `microbiology.manage`) are enforced server-side. An ACTIVE organization branch scope and matching active branch are required. Unknown kind, missing permission or bad data fail closed.

## Automated acceptance
- `tests/stage-82-legacy-master-import.test.ts`: parser, multilingual quoted fields, all four kinds, invalid type/header/code/email/category, duplicates, byte/row caps, tenant fingerprint, preview-only/commit transaction authorization source checks.
- `tests/stage-82-legacy-master-write-routing.test.ts`: actually invokes all four production ORM dispatch paths with constrained TransactionClient stub, verifies organization, IDs, fields, no unknown kinds.
- `tests/stage-82-legacy-master-import-mariadb.integration.test.ts`: real two-connection MariaDB stores all four master types with Arabic names and audit events, demonstrates cross-organization same code independence, rejects attempted overwrite, confirms transaction rollback of previously inserted new record when later row conflicts and original data remains unchanged.
- Stage 82 MariaDB integration added explicitly to CI, alongside full clinical/financial/branch MariaDB tests, safety/unit tests, Prisma schema checks, TypeScript, lint, Arabic UI and Next.js production build.

## Deployment and boundaries
- No schema migration and no new Hostinger environment variables.
- This version requires **mapping Access export columns to the exact normalized CSV template**. It does not parse native `.mdb` uploads or infer which legacy columns represent organism species, physician type, drug class, or billing relationship. Mapping must be reviewed by a knowledgeable user.
- It does not create/change corporate clients, historical patients, results, financial data, or price contracts. Existing reference-masters cannot be overwritten through this route.
- The commit is immediate only after explicit approval; prior read-only preview is not persisted as an editable import draft.
- Manual clinical and billing UAT still deferred until whole LIS completion; no claim of real data migration or production acceptance.
- Keep PR #128 Analyzer Bridge **OPEN/DRAFT/UNMERGED**; do not touch it.
