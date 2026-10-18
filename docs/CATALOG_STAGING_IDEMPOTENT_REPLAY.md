# Stage 148 — Durable catalog staging request identity and audited replay

Owner-confirmed baseline on Hostinger: `d760c4d73c9cd8548fb0c01bf510d150c30bc1f9`.

## Remaining integrity gap closed

The three catalog staging routes for `LEGACY_MDB_EXPORT`, `CSV_REVIEW` (including XLSX), and `CONFIG_BUNDLE_REVIEW` create a new `CatalogImportBatch` for every successful POST. Prior UI-only retry fences could prevent a second click in the same mounted React component but could not atomically protect against concurrent requests, network replay, or two requests with the same operation identity. Clinical or financial master rows were never applied by these staging routes, yet duplicate staging rows could corrupt provenance and make expert approval/row reconciliation ambiguous.

## Schema and transaction

- Nullable `catalog_import_batches.submission_key CHAR(36)` with unique composite `(organization_id, created_by_user_id, source_type, submission_key)`. Existing historical rows stay `NULL` and remain unchanged. The same request key is legitimately independent across tenants, distinct authors and source classes.
- Three existing clients send a once-per-attempt `x-family-lab-staging-key` UUID generated locally **before** possible POST. They retain their sticky ambiguous-outcome review fences from prior deployments. Old API clients without a key remain backwards compatible (not durably idempotent).
- Server validates UUID or explicitly absent key. For valid keyed requests, the application recomputes the original source checksum and validates all existing catalog, finance, branch, department, clinical scope, source and attestation restrictions; then acquires the **same active organization lock** as the existing stage transaction.
- Only *after live authorization* the server looks up a prior batch scoped to organization, actor, source class and key. Same checksum, source name and unprocessed stage status returns its **identical batch UUID**, with `replayed: true` and HTTP 200. A changed payload or source name, or an already processed batch, returns HTTP 409 `catalog_staging_key_reused`. New successful keyed requests store `submissionKey` atomically with rows and audit as before, return `replayed: false` and HTTP 201. A replay does not create additional rows or audit events; original audit remains attached to the original creation.
- The database composite unique constraint provides a final guarantee against concurrent same-key inserts. Transactions still serialize through the existing organization lock, and no later change to prices, units, ranges, reporting or released results can be implied by a staging replay.
- Deliberately do **not** deduplicate merely by upload checksum: an operator can choose to stage the same file again under a **new** request ID for a separately tracked review, and a different author's draft remains private.

## Acceptance and limits

`tests/stage-148-catalog-staging-idempotency-safety.test.ts` verifies key validation, tenant/author/source lookup scope, fingerprint/status conflict behavior, and all three client/server replay paths.

`tests/stage-148-catalog-staging-idempotency-mariadb.integration.test.ts` verifies the actual composite DB uniqueness, permitted cross-actor/tenant/source requests and backwards-compatible nullable historical rows.

This provides *durable same-key deduplication* only: no claim that a browser reload will automatically reuse its previous key. The UI continues to direct a user to reconcile the batch list/audit after uncertain network outcomes. HTTP 200 on replay certifies only the staging request identity, **not** actual clinical/finance equivalence or a qualified source snapshot.

**NOT_EXECUTED**: real browser AR/EN/RTL/mobile/branch role interactive review, network partition tests with Hostinger proxy, full 81-route browser screenshots and clinical/finance/data reconciliation signoffs. **Issue #265 OPEN**. **Issue #250 NO_GO**. Production deployment requires exact-head feature CI, independent exact-merge `main` CI, migration verification and owner Hostinger acknowledgement. No intentional reduction of the 88-section master scope.
