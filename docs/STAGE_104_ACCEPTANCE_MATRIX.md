# Stage 104 — Legacy Specialty Reference Evidence: Safe Extraction and Review

## Scope and source of truth

- Base: main `e48d9b50c17a4ee5afad149410e8443291733d60` (Stage 103, confirmed deployed on Hostinger).
- Master scope §7/§11/§34/§88 and `03_LEGACY_ACCESS_ANALYSIS.md`: the cleaned MDB is a source of specialty panel composition, historical low/high candidate ranges, and clinical workflow clues, **not** a safe production reference-interval authority.
- Existing `scripts/legacy/export-family-lab.ps1` exports generic tests/units/profiles/normal; it does not inspect specialized `*n` reference tables.
- Existing `src/app/api/catalog/imports` implements staged imported catalog records and independent clinical reference-interval review. Existing Stage 103 specialty layout UI supports group/width/hint batch edits.
- This stage adds the **missing local specialty evidence extraction and a fail-closed read-only matching UI**, without bypassing the normal clinically approved workflow or duplicating staging functionality.

## Included

1. `scripts/legacy/export-specialty-reference-evidence.ps1`: local Windows-only OLE DB/ACE reader, source file read-only, explicit allowlist of legacy reference tables documented by the Access analysis (`cbcn`, `coagn`, `fertn`, `Glycosen`, `kidnyn`, `lipidn`, `livern`, `Thyroidn`, `TORCHn`, `Tumern`). Matches only low/high-paired columns by structural field suffix; extracts only numeric bounds and explicitly named sex/age selector columns, not ID/name/patient/transactional data. SHA256 of original local MDB, raw column provenance and row ordinal are recorded. A no-partial-output threshold and atomic file write prevent truncated exports masquerading as complete.
2. `src/lib/legacy-specialty-evidence.ts`: rejects unexpected tables, legacy patient/order records, invalid bounds, duplicate pairs/row numbers, corrupted/unsupported source schema and falsely preapproved clinical data. No clinical units/methods are inferred.
3. `POST /api/catalog/legacy-specialty-evidence`: permission `catalog.manage`, active branch scope and scoped target test, bounded JSON upload; returns ephemeral **aggregates only**: exact component-code matches vs unmatched/ambiguous pairs; incomplete/inverted bounds and unusual sex/age selectors. Raw candidate low/high evidence is **not returned, staged, logged or persisted**. The submitted source SHA256 is informational and cannot be independently verified server-side without the original MDB.
4. `LegacySpecialtyEvidenceReview` attached to existing `/catalog/tests/[id]`. Arabic/English with table/column evidence and unmatched component warnings. No Create/Apply button and no clinical import.
5. Automated safety parser contract tests plus real MariaDB test of tenant-scoped component matching, no new reference-interval writes. New CI step.

## Windows extraction operator instructions

From the checkout on Windows, after ensuring ACE OLE DB is installed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\legacy\export-specialty-reference-evidence.ps1 `
  -MdbPath "C:\path\to\Family lab -test.mdb" `
  -OutputPath "C:\secure\family-lab-specialty-evidence.json"
```

The evidence output can include reference-range numbers and demographic selector information. **Keep the JSON private and secure**; upload it only to the authorized `catalog.manage` screen over HTTPS. Do not upload the full MDB to the application for this workflow.

This PowerShell/ACE workflow cannot be exercised in Linux CI. The exact actual MDB schema/pairing and the accuracy/completeness of the exported candidate rows must be validated on Windows using the supplied cleaned Access file before accepting any evidence as complete. This stage does not claim those source tables were inspected live in this environment.

## Not done / required before clinical use

- Actual clinical matching of a candidate to a test/method, component, unit, sex, age unit and interval, plus source row provenance, needs qualified laboratory validation. Exact text/code matching is only a *hint*. No automatic clinical intervals may become active.
- Importing candidate ranges must use the existing controlled interval staging/reconciliation/independent approval process, with effective dates, overlapping-range checks, and preserved historical snapshots. This stage implements **no auto-import**, no alteration of released clinical results, and no pricing changes.
- Existing legacy catalog, profiles, pricing, microbiology dictionary and comment import workflows remain unaffected.
- Analyzer/device, printer, browser, production configuration and clinical UAT remain deferred until full scope completion.

## Verification and unrelated work

- Safety tests: `tests/stage-104-legacy-specialty-evidence-safety.test.ts`
- Real MariaDB: `tests/stage-104-legacy-specialty-evidence-mariadb.integration.test.ts`
- Full feature and independent post-merge main CI required on exact SHAs.
- No migration. Keep Draft PRs #128, #209 and #224 untouched.
