# Stage 41 — Component Import Review Disclosure, Source Authorization and Bounded UI

**Baseline:** owner-confirmed Hostinger Stage 40, `main` `efe15aad09a700790b1f2145a50e5a3cd576a405`, exact merge CI #932 SUCCESS.

## Confirmed gaps

The Stage 25/33 read-only component reconciliation API paginated 100 rows, but still normalized and resolved imported, skipped and error rows against clinical masters before blocking them. It returned their source candidate, original validation issue metadata and possibly resolved test/unit identities despite the blocked disposition. Unknown/out-of-branch/department test candidates could also echo clinical source through this additional endpoint. The whole-batch duplicate query was unbounded and considered processed/error rows as duplicate signals. For CSV_REVIEW source batches, range reviews had author-only access while component reconciliation could be called by another catalog manager within the same organization. The UI appended each reviewed 100-row page without a bound.

## Implementation

- `src/lib/component-review-disclosure.ts`: shared fail-closed `VALID`/`WARNING` eligibility, safe null-candidate response for ineligible/out-of-scope source and CSV_REVIEW author gate.
- The component reconciliation endpoint rejects non-author CSV_REVIEW requests before accessing candidate rows. Existing organization, current active branch, department/test and `catalog.manage` authorization remain mandatory.
- Processed/error rows do not enter parent/unit resolution. They return null candidate, null clinical identities, empty staged source issues and a minimal blocked issue code. Unresolved parent tests, including out-of-clinical-scope tests, are equally redacted; no untrusted source metadata is echoed.
- Whole-batch duplicate detection includes only `VALID`/`WARNING` rows and is capped at 20,001 rows, rejecting larger batches with HTTP 409 rather than performing unbounded analysis. Existing 100+1 pagination continues.
- The CSV_REVIEW batch page gates component **and** reference-range source preview to the importing user whenever either entity exists; reference range review still requires `catalog.reference_ranges.manage`. Legacy source access is unchanged.
- The bilingual component UI now fails closed if the API lacks `liveWrites:false` or `approvalRequired:true`, returns more than 100 rows or sends malformed pagination/redaction structure. It replaces rather than accumulates pages, with back/next/restart controls and no approval or posting action.
- Added deterministic `tests/stage-41-component-review-safety.test.ts` and a dedicated **two-connection MariaDB integration test** for source ownership, multi-tenant isolation, 100/101 boundary identity, processed/error exclusion and unchanged source records. Wired into CI.

## Hard acceptance boundary

This increment is **read-only** and does not approve, import, modify or release a laboratory result or master component. No historical clinical values, reports, specimen trail, invoices, reference ranges, or prices are overwritten. Component import approval and legacy migration remain explicit future master-scope tasks.

**Engineering gates:** successful CI on exact feature HEAD and on exact merged main SHA, with Prisma migrations, safety, multi-session MariaDB, TypeScript, lint, AR/EN checks and Next build. Manual clinical/analyzer/printer/barcode and complete multi-branch UAT remain **DEFERRED** until the complete implementation; Hostinger deploy verification remains with the owner. All 88 sections of `02_MASTER_SCOPE.md` remain in scope. Separate Analyzer Bridge PR #128 remains Draft/unmerged.
