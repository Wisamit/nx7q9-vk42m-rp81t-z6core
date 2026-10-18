# Issue #265: governed legacy reference interval import review

Baseline is owner-confirmed Hostinger deployment of `main` `83a41c877337449120b91e17b999616f6c4e6db0`.

## Verified defect and closure

`ReferenceRangeImportButton` previously used native `confirm()` for the exact-match interval import and fired `resolveSafeLegacy()` immediately from a button. The latter chains THREE mutation-capable endpoints (`/commit`, `/prepare-units`, `/reference-ranges`) and may create eligible master records as well as inactive ranges. Its operations cannot be atomically rolled back across endpoints. The old UI did not make this partial-commit possibility or the clinical non-approval boundary clear.

The same page now provides distinct **compact, centered, bilingual review dialogs** for both actions:
- exact batch identity and the total, eligible, and manual-review row counts;
- for safe legacy resolution, the count of generated master tests still pending;
- explanation that master test recovery / unit preparation / interval staging may create real catalog records and that separate calls are NOT one atomic transaction;
- explicit `onSubmit` confirmation, disabled while submitting; cancellation never posts;
- refreshed GET preview recheck before any POST, with an independently tested, fail-closed pure integer-count comparison. Changed counts cause a new review prompt rather than an implicit submit;
- a synchronous `inFlight` guard against duplicate submit; related manual test/unit aliases also block concurrent writes and handle network errors;
- any network/server error after a POST attempt blocks in-dialog retry, since writes could already be committed. The operator must inspect batch history, refresh, then explicitly open a new review. The UI never says rollback occurred.

The server remains the authority for scopes, catalog entities, exact test/unit/context mapping and audit. The pre-existing range endpoint stages any imported range as `INACTIVE` and does **not** approve it clinically. Any manual-review interval is excluded. No reference ranges were changed by this development run.

## Regression

`tests/ui-reference-legacy-import-explicit-review.test.ts` verifies count validation (invalid, drift, stable), explicit distinct dialog actions, GET-before-POST order, partial-write network no-blind-retry, manual mapping duplicate/failure guards, unchanged server permissions and inactive range creation.

**No schema migration, no new service mutation, no automatic clinical approval or result release.** In the future, server-side compare-and-swap could strengthen the current client-level preview staleness check; this UI improvement alone is not a transaction lock.

**NOT_EXECUTED:** every-branch actual browser/modal accessibility, all 81-route visual screenshot/RTL/light/dark acceptance, specialist assessment of legacy catalog source reconciliation, and clinical reviewer approval. **Issue #265 OPEN**. Overall software/clinical/finance/device/Hostinger restore UAT remains **NO_GO** under Issue #250. The clinical import dashboard is not a certificate of MDB parity or production readiness.
