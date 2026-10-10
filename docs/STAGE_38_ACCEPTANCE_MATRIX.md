# Stage 38 — Bounded, Status-Safe Staged Price Window Reconciliation

**Baseline:** Stage 37 owner-confirmed Hostinger main `705069741230b9d7f5fc5b5803f5d7e6c8883902`, CI #925 SUCCESS on that exact SHA.

## Audited gap

The current Stage 26 pricing reconciliation reads all staged price windows (unbounded at the endpoint), then rescans every staged candidate for each 100-row page row. This causes avoidable quadratic work. It also includes error, imported and skipped staged rows in overlap warnings, potentially causing false review blocks. Processed/error price rows could still echo monetary candidates and old validation issues in the pricing review API. These are real financial-review integrity and data-disclosure risks, even though this endpoint never posts prices.

## Implementation

- `stagedPriceOverlapIndex` uses exact normalized price-list and test source codes and explicit validated effective dates. Sort per identity and inspect prefix maximum-end / next start, O(N log N) rather than repeating a batch scan per reviewed page row. Conservatively flags touching endpoints and open-ended intersections without inventing financial precedence or tax policy. A collision marks **both** participating eligible rows.
- Only `VALID`/`WARNING` staged rows can enter whole-batch overlap analysis. `ERROR`, `IMPORTED` and `SKIPPED` do not create price-window conflicts. No coercion or conversion of `DECIMAL(18,4)` amounts.
- Whole-batch candidate query selects only row number, status, normalized JSON, with a 20,001-row sentinel and explicit 409 rejection beyond the 20,000 bound.
- The paginated read-only endpoint redacts every non-reviewable row before price-master resolution: blank amount/date/codes, empty source issues, null currency and resolved IDs. Existing unauthorized/out-of-branch price-list redaction remains enforced. Audit records counts only.
- Added unit and source guards `tests/stage-38-staged-price-overlap.test.ts`; two independent MariaDB sessions in `tests/stage-38-staged-price-overlap-mariadb.integration.test.ts` verify tenant isolation, 100/101 page boundary, cross-page conflict warnings, exclusion of non-reviewable rows and unchanged staged data. CI executes the new MariaDB integration suite.

## Remaining scope and acceptance gates

- This is **only read-only price reconciliation**. No price list/item activation, invoice rewrite, currency conversion, tax decision, contract/branch/client price precedence or approval. Import governance must resolve approvers, effective date precedence, audit and history-safe transactional activation before financial writes.
- All 88 sections of `02_MASTER_SCOPE.md` remain mandatory, including complete CSV/Excel import/export, safe legacy conversion, provider and analyzer integrations. `CSV_REVIEW` upload is not a round-trip of the flattened CSV review export.
- PR #128 separate Analyzer Bridge stays Draft/unmerged; never merge routinely.
- Manual UI, hardware, analyzer, barcode, clinical, finance sign-off and full multi-branch UAT remain **DEFERRED** until implementation complete, not accepted by automated CI.
- Merge only after exact final feature HEAD completed SUCCESS with Prisma migration/status/generate, safety, two-connection MariaDB, TypeScript, lint, bilingual UI and Next.js build; verify merged main SHA CI independently. Owner verifies Hostinger deployment.
