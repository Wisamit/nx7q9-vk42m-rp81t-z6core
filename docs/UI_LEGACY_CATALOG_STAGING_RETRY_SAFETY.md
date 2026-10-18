# Issue #265 — Legacy catalog JSON stage receipt and retry safety

Baseline deployment confirmed by owner on Hostinger: `5edacee3b077e59180854bfabc02f7a4f448741a`.

## Identified defect

The existing `LegacyImportBatches` performed an unprotected new-batch creation POST to `/api/catalog/imports` and displayed a generic error when the response could not be read. The same `ReviewFileUploadDialog` then allowed another confirmation without checking whether the original request had already committed in MariaDB. Each successful POST creates a new `CatalogImportBatch`, so lost responses can lead to duplicate staged evidence, repeated source filenames and ambiguous provenance. The UI also showed import creation dates by slicing ISO UTC strings, ignoring organization date display format and local timezone.

## Scope of this change

- Client now checks local file extension, 32 MiB limit, JSON parsing and array cardinality (1–20,000 rows) **before** claiming the network attempt. Local parse errors are correctable without sending a POST.
- Once a staging POST is started, a synchronous ref guard and `retryBlocked` flag prevent the user resubmitting from the current mounted session, including HTTP rejection, missing/malformed response and connection interruption. The operator is instructed to inspect the batch list and audit trail and reload before retrying. This is a client-side duplicate prevention safeguard, **not a server idempotency guarantee**.
- New pure `validateLegacyStageReceipt` checks batch UUID, status, positive exact total, safe integer VALID/WARNING/ERROR counts, exact sum matching submitted row count, and DRAFT versus VALIDATED consistency. An HTTP 2xx without this evidence is an **uncertain result**, not success.
- Confirmed stage shows the exact new batch identity as a review link and truthful counts; it does **not** import clinical catalog, prices, or reference intervals into the live configuration. The uploader keeps review-only warnings visible. Common `ReviewFileUploadDialog` can accept an optional `retryBlocked` state; its other consumers retain the previous default.
- The legacy-batches table now uses `SystemDateText kind="instant-date"` instead of slicing the UTC date, respecting the organization's configured date format and timezone in AR/EN.

No API or database changes. Original POST still locks the active organization, revalidates live catalog/pricing/range permissions and branch/department scope, inserts batch and staged rows within one transaction, and appends audit `CATALOG_IMPORT_STAGED`. No new clinical or financial histories or prices are generated.

## Verification

`tests/ui-legacy-catalog-stage-response-retry-safety.test.ts` exercises valid draft/validated and malformed stage responses, local-before-POST ordering, no-blind-retry fence, preserved shared-modal behavior and central date formatting. Full TypeScript, lint, safety, MariaDB and production build gates should pass on the exact feature SHA and independently on the merge SHA.

**NOT_EXECUTED:** production server/idempotency race simulation, browser-interactive modal/keyboard/Arabic RTL proof, qualified 81-route visual review, legacy source row-identity reconciliation, real finance/clinical signoff and physical backup/restore. **Issue #265 OPEN; Issue #250 NO_GO.** No clinical GO or complete migration parity is inferred from CI.
