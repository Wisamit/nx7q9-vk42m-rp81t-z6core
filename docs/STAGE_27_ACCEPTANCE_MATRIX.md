# Stage 27 — Controlled Catalog CSV Review Export

**Base main:** `710b2f2f2a9dfd52ea83edff84d1e63cf75cbf2b` (Stage 26 merged). This increment addresses a limited, previously unmet export format in Master Scope §87.

## Source audit

Stage 24 had already implemented permission-scoped, audited, paginated JSON export for TEST, COMPONENT, UNIT, REFERENCE_INTERVAL, PRICE_LIST and PRICE_LIST_ITEM. Stage 25 and Stage 26 added read-only import reconciliation. No new import commit permission is authorized by this work.

## Implemented

- **CSV for one selected entity category** via the existing bilingual `CatalogConfigurationExport` page; users select exactly one category for CSV. Multi-category JSON export remains available and unchanged.
- **Reuses existing protected JSON API** for every fetched page: tenant, active branch and department scope, `catalog.manage`, and `pricing.manage` for financial classes, 250+1 ID keyset pages, audit events and cache controls. No new independent API access surface.
- **Client-side review serializer** in `src/lib/catalog-review-csv.ts`: stable flat `field.subfield` columns, fixed provenance columns (`exportFormat`, `schemaVersion`, `organizationId`, `entityType`, `exportedAt`, `consistency`), UTF-8 BOM for Arabic, CRLF lines, quoted cells and escaped double quotes.
- Retains **decimal text** from the JSON API (Prisma Decimal is serialized as a precise string). Negative numeric clinical limits can remain signed numbers.
- Adds spreadsheet formula-injection mitigation for untrusted label/comments starting with `=`, `+`, `-` or `@` (including whitespace/control prefixes). Formula-like cells receive a leading apostrophe; this intentionally changes their raw CSV representation.
- No partial file on an API failure, invalid cursor, over-limit paging or unsupported format; no patient data or clinical/financial writes.
- `tests/stage-27-catalog-review-csv.test.ts`: Arabic/quoted values, decimal fidelity, formula injection, fail-closed schema guards, and source-level retained API permission contract.
- `tests/stage-27-catalog-review-csv-mariadb.integration.test.ts`: two independent MariaDB connections with tenant/branch-priced records, exact decimal from stored `DECIMAL(18,4)`, a malicious spreadsheet-formula name and exclusion of unauthorized records. Added to GitHub CI.

## Important constraints and outstanding scope

- CSV is **human review output**, NOT a lossless round-trip import, database backup or approved restore format. JSON is the authoritative structured export; both are **paged live and not a fixed-time atomic snapshot**.
- The CSV serializer flattens nested fields into dotted column names and protects spreadsheet formula-like text. These transformations can alter raw CSV cells intentionally. Do not automatically reimport them as clinical or price configuration.
- CSV scope is one entity category at a time; importing CSV/Excel under clinical/finance governance and preserving all source metadata remains future work. All 88 Master Scope sections remain binding.
- No clinical component import/price posting authorization, new tax conversion, reference-range changes, report-version rewriting or analyzer changes. Analyzer Bridge PR #128 remains Draft and unmerged pending separate review.
- Manual UI, instrument, barcode/printer, clinical/financial UAT and actual backup/Hostinger deployment acceptance are **DEFERRED**, not represented as passed.
