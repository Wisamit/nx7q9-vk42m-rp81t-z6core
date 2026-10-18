# Issue #265 — Manual outbound webhook dispatch safety and truthful results

Baseline: `main` `7550d08c2773ecbabcc7e9f7ee671bd849ac7a58`, confirmed by owner on Hostinger.

## Identified operational defect

`IntegrationManager` previously triggered `POST /api/integrations/webhooks/dispatch` on the first click of a normal page button, without deliberate review of the external transmission. The common mutation helper showed **"Webhook dispatch run completed"** whenever the batch endpoint returned HTTP 200, even when a delivery had failed, entered dead letter, encountered a dispatch exception, or lost the compare-and-swap claim. This is misleading for external diagnostic report delivery; provider processing acknowledgement is a separate requirement.

## Changes

- A **compact bilingual centered review dialog** now precedes manual external dispatch and explicitly explains external transmissions, current-queue dependent up-to-20 batch size, authorized branch limits, at-least-once retries, receiver deduplication by `x-family-lab-delivery-id`, and that provider/clinical receipt is not established by an HTTP 2xx.
- Only an actual confirmation form submit triggers the original POST. Both UI state and synchronous `submitting` guard prevent duplicate submission. Cancel does not send anything.
- A dedicated pure `summarizeWebhookDispatch` validator requires a bounded integer `attempted`, a matching result count, distinct nonblank delivery IDs, known delivery statuses and nonnegative attempt counts. Unexpected/incomplete data are **NOT** treated as success.
- Success reports exact counts for `DELIVERED` (HTTP-accepted, **not** provider's verified processing), `FAILED`, `DEAD_LETTER`, `DISPATCH_ERROR`, and `SKIPPED_CONCURRENT_CLAIM`. Partial failure appears as an error, and an empty run is reported as **no attempts**, not successful message delivery.
- Once a POST may have reached the server, the UI disables repeat manual dispatch until a full page reload and inspection of the queue/audit, including connection failures and unconfirmed responses. `router.refresh()` refreshes displayed server evidence but does not silently lift the UI's no-blind-retry fence.
- Existing API authorization (`integrations.replay`), organization/branch scope, due-status limits, CAS and stale report safety remain untouched. No schema migration, no change to wire payload or downstream delivery policy.

## Regression and release boundary

`tests/ui-webhook-manual-dispatch-review.test.ts` verifies valid/partial/empty/malformed outcome handling, the separate dialog confirmation, sticky no-blind-retry guard, API scope/20 maximum, delivery CAS and receiver deduplication contract.

**NOT_EXECUTED:** authenticated rendered AR/EN/RTL mobile and keyboard modal review, live endpoint/network/provider delivery tests, external partner duplicate-receipt UAT, and full 81-route screenshots. **Issue #265 OPEN. Issue #250 NO_GO.** The release cannot be certified without qualified external delivery/device/clinical and disaster-recovery evidence. The required master scope is unchanged.
