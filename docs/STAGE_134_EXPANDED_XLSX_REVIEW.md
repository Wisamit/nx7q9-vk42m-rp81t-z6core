# Stage 134 — Expanded XLSX/CSV Catalog Review, Author and Pricing Isolation

**Baseline:** Stage 133 merged SHA `ba7d586e0fa548c0c42580538431aa8684456b86` (owner confirmed deployed; independent main CI #38730803556 SUCCESS). **Master Scope §87.** This stage expands **review-only** spreadsheet staging, not direct activation or an approved configuration migration.

## Implemented scope

The pre-existing CSV/XLSX DRAFT-only staging route `/api/catalog/imports/csv` now accepts nine bounded entity types:

| Type | Required review data | Guard |
|---|---|---|
| TEST | Code, nameEn, nameAr when available | Existing catalog.manage, active branch + clinical scope |
| UNIT | Code, explicit unit symbol; optional names | catalog.manage, author-only preview; UCUM review |
| CONTAINER | Code and nameEn | catalog.manage, author-only preview |
| PANEL | Code, nameEn, **memberTestCodes explicit JSON string array** | New CSV-only validation rejects empty, repeated or invalid membership; clinical scope |
| PACKAGE | Code, nameEn, explicit memberTestCodes JSON array | Existing package validation retains INACTIVE governance warning; clinical scope |
| COMPONENT | testCode, component code/name, unitCode and type | Existing validation and clinical scope; no live writes |
| REFERENCE_INTERVAL | testName, unit, sex/age and interval values | Existing reference range permission, validation and specialist approval |
| PRICE_LIST_ITEM | priceListCode, testCode, exact DECIMAL tariff and effective dates | pricing.manage, clinical scope and review-only warnings |
| PRICE_LIST_PACKAGE_ITEM | priceListCode, packageCode, exact DECIMAL tariff and effective dates | **pricing.manage now explicitly required**; clinical scope; INACTIVE review |

New CSV and XLSX template downloads cover test/unit/panel/package/container masters and commercial package prices alongside the existing component, test tariff and reference range templates. The XLSX reader permits up to **32** explicitly whitelisted CSV columns (formerly 24), with the same **2 MiB compressed**, 20,000 row, finite ZIP inflation, CRC, one visible sheet, XML and formula safeguards. Field values are exact text; dates are never silently inferred from Excel serials. Unrecognized columns and entity types are rejected.

Every spreadsheet import remains:
- `sourceType: CSV_REVIEW`, `status: DRAFT`, `validatedAt: null`, `reviewOnly: true`;
- bound to original uploaded bytes SHA-256 and audited as XLSX/CSV;
- **denied** by existing `/commit` and `/revalidate` routes, irrespective of apparently valid rows;
- prohibited from changing existing prices, effective dates, historical clinical data, results or released report snapshots.

### Regression isolation

The clinical validation added for panel membership, and review-only warning for TEST/UNIT/CONTAINER, is implemented in **`src/lib/catalog-expanded-csv-review.ts`** and invoked ONLY from the CSV/XLSX route. The legacy MDB `/api/catalog/imports` pathway is intentionally not subjected to new spreadsheet-only membership/preview restrictions; existing safe-master and historical workflows must remain stable. The candidate normalizer retains Arabic names and parsed membership for review evidence.

The upload and review page now explicitly require current `pricing.manage` for PACKAGE prices (not only TEST price rows). `CSV_REVIEW` preview requires the **same current author** before loading source/normalization records; stale cross-user catalog readers cannot view clinical or financial drafts. All clinically meaningful spreadsheet candidates must have an active medical branch/department import scope as enforced by the existing resolver.

## What is deliberately still OUTSTANDING

1. This is **review and evidence preparation**, not round-trip spreadsheet import/activation parity for every exported structured field. A downloaded complete export XLSX is still a review view, not an automatic restore. Signed, atomic JSON bundles remain the stronger provenance format.
2. PRICE_LIST master creation, branch/client/contract-specific price activation, analyzer/method mapping, advanced configuration mapping and qualified activation workflow require separate role and policy review; no unreviewed workbook can grant those privileges. Master Scope §87 remains **partially open**.
3. The real-world UAT register for Stage 132 remains NOT_EXECUTED. All clinical, physical analyzer, print, cash, offsite restore and vendor tests require qualified signoff; `main` CI is not clinical GO.
4. §75 interference policy, §86 local tax/currency rules and §88 legacy MDB source-row parity remain explicitly unresolved. No patient/result data is placed into source control.

## Test/release policy

`tests/stage-134-expanded-xlsx-review-safety.test.ts` covers all new template master types, XLSX → canonical CSV roundtrip, Arabic names, explicit ordered panel/package membership, duplicate/invalid membership rejection, exact DECIMAL package prices and the author/financial/commit safety gates. CI also runs the existing Stage 28 + 133 tests, MariaDB, TypeScript, lint, AR/EN/RTL/theme and Next production build.

Merge only after successful complete feature HEAD CI, exact expected-SHA merge, and fresh independent `main` push CI. Owner deploys Hostinger, not CI. Draft #128 and #209 stay separate.
