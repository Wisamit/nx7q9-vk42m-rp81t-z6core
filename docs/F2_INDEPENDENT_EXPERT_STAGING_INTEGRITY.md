# F2 — Independent expert stage-integrity gate

## Boundary

This checkpoint hardens the established Stage 53/54/56 independent expert
preflight (GET `?reviewFlagId=<uuid>`) and disposition (PUT), while leaving
existing author-only diagnostic drift GET, referral POST, and governance policy
draft workflows available as **review-only** activities.

A current `catalogDriftObservationToken` verifies that a flag refers to the
same source/live JSON values within a key/checksum/rowNumber observation.
**It cannot alone establish that the stored staged JSON remains the original
data that were read and accepted by staging**: a separate writer of the DRAFT
tables could rewrite JSON and create a new observation.

## Expert gate (fail-closed, before any expert flag or decision)

Under the existing tenant-locked `RepeatableRead` transaction, the route:

1. Re-reads the full DRAFT batch, current user/session permissions, and all
   staged rows for a maximum of 5000 records. The projection now includes
   `legacyKey` and `validationIssues` in addition to both persisted JSON
   columns, row ordering, status, importedEntityId, and row UUID.
2. Extracts the persisted stage seal from the batch summary and reconstructs
   the original batch metadata (including sourceType/name/DRAFT status,
   source attestations, field contract, export consistency and category counts).
3. Calls `verifyIndependentExpertStage`. It requires a valid **v2**
   HMAC-SHA256 of full source/normalized row evidence and batch metadata
   against organization/batch/author/checksum and current signing key.
   Missing signing key, missing seal, malformed/tampered evidence or a v1-only
   seal returns HTTP 409 `expert_staged_evidence_integrity_error`.
4. Only after valid stage integrity, the separately captured original export
   must be `VERIFIED`, have
   `COMPLETE_SOURCE_FIELD_PROJECTION`, and have
   `transactional-consistent-read`. Otherwise the expert route rejects
   with HTTP 409 `expert_source_not_qualified`, even when a new valid v2
   seal was produced over that weaker staging.
5. The previous whole-batch branch/department/clinical/financial scope
   checks, independent reviewer identity, latest immutable flag and current
   signed observation, and single decision audit guard remain required.
   A successful check grants **no** clinical or financial release permission.

The expert-only gate runs **before** looking up the requested expert flag,
so a rewritten staged source cannot be used to justify an independent
decision. Author diagnostics for old/unsigned sources are not implicitly
promoted into independent clinical or financial decisions.

## Verified scope

- No database schema or migrations in this increment.
- No new API may import/apply these bundles; `CONFIG_BUNDLE_REVIEW` and
  `CSV_REVIEW` continue to fail the legacy commit guard.
- No updates to clinical/financial master records or released results.
- No UI or report exposes source/live clinical values, private tariff identities
  or original JSON through this error; failure messages use stable codes only.
- Older v1 and unsigned/paged/legacy field-contract DRAFTs require a fresh,
  qualified restaging for independent expert consideration; previous audit
  history is retained and not retrospectively converted into approval.

## Automated tests

- `tests/f2-independent-expert-staging-integrity.test.ts`: exact successful
  v2 evidence; source/normalized row mutation, warning metadata change,
  row order/status change, foreign author/tenant/batch/checksum, unsigned,
  weak original source, v1-only seal, and static GET/PUT route positioning.
- `tests/f2-review-batch-metadata-mariadb.integration.test.ts`: real
  independently connected MariaDB sessions now invoke the expert gate as
  well as the policy-review integrity checks. A valid re-signed weaker source
  is refused, a mutated row or summary is refused, restored evidence passes.

## Not completed

Source installation lineage, portable source-to-target mapping, qualified
medical/financial signatory policy, distinct versioned apply/corrective
reversal, and true export→approved apply→re-export parity remain unfinished
F2 items (`BLOCKED_EXTERNAL` where explicit human authority is required).
F2 remains IN_PROGRESS; F3 not started. Draft PR, Hostinger HOLD.
