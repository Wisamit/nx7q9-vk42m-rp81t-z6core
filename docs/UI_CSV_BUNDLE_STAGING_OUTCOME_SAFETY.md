# Issue #265 — CSV/XLSX and signed JSON bundle staging outcome safety

Owner-confirmed deployed baseline on Hostinger: `56e3751b411c73656b0f437c84699f698ac06ab3`.

## Actual defect

`CatalogCsvReviewStaging` and `CatalogBundleReviewStaging` POST files to API endpoints that create a *new author-private draft import batch* for each successful request. After a network interruption, HTTP rejection, missing response, or invalid response, their previous UI allowed immediate resubmission of the same file. This can create duplicate private staged evidence whose provenance becomes ambiguous. CSV accepted any response with a truthy `id`; bundle accepted a truthy `id` and `reviewOnly: true` without validating immutable identity, DRAFT status or row-count consistency.

## Changes

- Existing compact centered `ReviewFileUploadDialog` is retained; both clients now pass the existing optional `retryBlocked` prop introduced for legacy MDB source staging. Local type and size checks run **before** POST and remain correctable.
- Both workflows use independent synchronous `inFlight` and `stageAttempted` references. As soon as a POST might be sent, set a sticky retry fence; the current mounted session cannot unknowingly send the same request again. On ambiguous response or network failure, show Arabic/English instructions to examine **private batch review history and audit**, then reload before any new upload.
- New pure `validateReviewStageReceipt` only accepts a UUID identity, `DRAFT`, `reviewOnly: true`, an integer total within the corresponding server row limit and nonnegative integer VALID/WARNING/ERROR counts summing precisely to total. Absent status counts are zero as documented by server payload semantics, but **explicit null** and malformed numeric values are rejected. For signed bundle review, every staged row must remain `WARNING`, per the existing API contract; no approval or import is inferred.
- Only a confirmed review-only receipt can cause client navigation to `/catalog/imports/[id]` and `router.refresh()`. The existing server remains responsible for branch/department scope, consent, private source verification, audit, and signed export attestation.
- No server route/schema/transaction/permission/released result/clinical interval/pricing changes. The client retry fence is **not a server-side idempotency key**: a full reload does not prevent intentional duplicate uploads, so a future separate idempotency design must preserve legitimate repeat reviews and provenance.

## Regression and remaining release gate

`tests/ui-catalog-csv-bundle-stage-retry-safety.test.ts` runs positive/negative pure receipt cases, stale statuses, mismatch, invalid counts, malicious approval flags, source review type-specific invariants, explicit dialogs, sticky submission fences, no client auto-retry, and untouched server authorization.

**NOT_EXECUTED:** browser-interactive AR/EN, keyboard focus, mobile modal, real network drop/replay simulation, 81-route screenshot review, real legacy clinical/finance reconciliation, expert partner signoff and verified production restore. **Issue #265 OPEN**; **Issue #250 NO_GO**. Hostinger deployment must be independently confirmed by the owner after exact-feature and exact-merged-main CI success.
