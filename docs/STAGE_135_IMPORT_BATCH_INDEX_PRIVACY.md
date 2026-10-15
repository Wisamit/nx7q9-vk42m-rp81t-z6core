# Stage 135 — Prevent Cross-User Catalog Spreadsheet Review Metadata Disclosure

**Base/main:** `8c8b2144814b527d0dc70a48dd479bb723ae5646` (Stage 134, verified successful independent main CI). **Scope references:** §§63, 72, 79, 87; Stage 134 expansion of CSV/XLSX review staging, Stage 132 real-world UAT still pending.

## Confirmed security finding

The existing catalog import **detail** page binds `CSV_REVIEW` and `CONFIG_BUNDLE_REVIEW` raw content to the creator. The catalog **index** previously filtered CSV review batches by whether they contained reference-range rows and certain price rows, but not **unconditionally by batch creator**. Therefore a different `catalog.manage` user at the same organization could see an uploaded **source filename, row count, batch type, status, and creation date** for another user's CSV/XLSX draft if the draft did not contain range or price rows. Review filenames can expose sensitive analyzer/test/contract metadata. The ledger API already has an author filter for review batches.

## Correction

- Add `privateSpreadsheetBatchScope(userId)` under `src/lib/catalog-import-list-privacy.ts`. It allows non-review legacy batches to retain their existing role/financial restrictions but requires `createdByUserId === userId` for either `CSV_REVIEW` or `CONFIG_BUNDLE_REVIEW`.
- Apply this filter **inside the Prisma `catalogImportBatch.findMany({ where: ... })` query** on `src/app/catalog/page.tsx`. Never filter only after loading rows: that could still leak record counts and displace the viewer's own top-ten reviews.
- Preserve all existing `catalog.manage`, `pricing.manage` and `catalog.reference_ranges.manage` filters, original organization scope, range author controls and the detail-page author check. No clinical or financial modifications, schema migration, model change or privilege expansion.
- Add `tests/stage-135-import-batch-list-privacy.test.ts` with structural/authorization assertions and `tests/stage-135-import-batch-list-privacy-mariadb.integration.test.ts` with **two live MariaDB connections**, separate users in the same organization, a second tenant, both CSV and signed bundle uploads, legacy imports, and source-name segregation.

## Not closed by this change

This stage is a concrete **privacy regression fix**, not a claim of completed §87 export/import parity, confirmed third-party clinical compliance, real deployed Hostinger verification, or clinical UAT. The remaining §87 gaps include current PRICE_LIST vs CONTAINER coverage mismatch, full structured field round-trip, and expert-approved governed activation. §75 device-supplied interference semantics, §86 financial jurisdiction policy and §88 original Access row parity also remain open.

Retain Stage 132 88-case `NOT_EXECUTED` acceptance until independent qualified operator evidence is submitted. No synthetic test authorizes patient reports. No changes to Draft PRs #128/#209.

Release: feature HEAD green (safety, real MariaDB, types, lint, production build) → exact-SHA PR merge → green **independent main CI** → owner-controlled Hostinger deployment.
