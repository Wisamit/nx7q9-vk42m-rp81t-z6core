# Stage 28 — Tenant-Safe CSV Component / Price Review Staging

**Base main:** `364af6322ce57a43bf5f89932f003742aa507734` (Stage 27, exact `main` CI #894 SUCCESS; owner explicitly confirmed Hostinger deployment).

## Existing code and scope audit

- Stage 24 already provides six permission-scoped, reviewed JSON export classes and `COMPONENT`/`PRICE_LIST_ITEM` row staging.
- Stage 25 reconciles component mappings (read-only), Stage 26 reconciles price mappings (read-only), Stage 27 adds **CSV export for human review only**.
- Existing JSON import supports other legacy master types and has a separately controlled safe-commit allowlist. This stage **does not** extend that commit allowlist.
- Master Scope §87 still requires governed CSV/Excel import/export and clinical/finance approval; this increment closes only a conservative CSV staging portion.

## Delivered controls

| Requirement | Evidence / decision |
|---|---|
| Canonical CSV only | `src/lib/catalog-review-csv-import.ts` strict RFC4180-style text parser, quotes, UTF-8 BOM, Arabic, CRLF/LF, duplicate/unknown column rejection, exactly matched field counts, up to 2 MiB / 20k records / 8192 characters per field |
| Explicit source provenance | `CSV_REVIEW` source type, original raw cell values in `CatalogImportRow.sourceData`, normalized candidates, validation issues, checksum, creator, timestamp; no row text copied into audit |
| Exact numeric strings | Prices remain JSON strings, retain fractional zeroes and pass through existing staging validator. Invalid amounts/date context are recorded as row issues, never posted |
| Tenant and permissions | `catalog.manage`, at least one authorized active branch and `pricing.manage` if any price candidate is supplied. Organization-bound batch creation under one transaction |
| Review-only staging | New `POST /api/catalog/imports/csv?sourceName=...` creates `DRAFT` batch regardless of row validation; source code prevents any test component, price or invoice writes |
| Hard commit barrier | Existing revalidate and safe-master commit APIs both reject `sourceType === "CSV_REVIEW"` with HTTP 409. UI hides revalidate/commit buttons on these batches |
| Bilingual UX | `CatalogCsvReviewStaging` added to the catalog, Arabic/English instructions, canonical CSV template and import batch page for review |
| Test suite | `tests/stage-28-csv-review-staging.test.ts` tests parser boundary/input hostility and no-write behavior; `tests/stage-28-csv-review-mariadb.integration.test.ts` tests two-session transaction visibility, tenant isolation and source-value fidelity. Both are included in normal safety/MariaDB CI gates |

## Intentional exclusions and remaining scope

- Stage 27's CSV **review exports are not silently round-trippable**; they contain provenance/flattened fields and formula-safety prefixes. This stage intentionally accepts a **distinct canonical upload template**, not arbitrary exported CSV/Excel formats.
- Only `COMPONENT` and `PRICE_LIST_ITEM` are permitted for this upload. No automatic mapping, no batch revalidation/commit, no clinical/financial definition changes, no historical result/report/invoice rewriting.
- To enable future actual import, design an explicit governed approval, verified snapshots, controlled revision/activation, before/after audit, transaction/race and rollback policy; financial and clinical choices require approved policies.
- No Microsoft Excel binary `.xlsx` upload yet. Other entities, terminology mappings, legacy MDB conversion adapters and full §87 remain planned; all **88 sections** of `02_MASTER_SCOPE.md` remain in target.
- PR #128 Analyzer Bridge remains independent and unmerged. All manual UI, physical device, clinical/financial acceptance, and Hostinger deployment confirmation remain **DEFERRED** until appropriate completed-product acceptance. No CI pass is a medical validation claim.
