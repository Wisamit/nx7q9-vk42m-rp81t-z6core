# F2 — Expert queue signed DRAFT evidence gate

## Rationale

The Stage 54/56 independent expert GET/PUT pathway now requires the full
HMAC-SHA256 v2 stage evidence and a verified, field-complete, transactionally
consistent original source. The adjacent expert-review-queue previously
selected DRAFT rows by current session/live grants and nominal staged
identities, but did **not** enforce the same cryptographic source gate.
It could therefore display flags on altered or unqualified batches,
although any subsequent expert preflight would reject them.

## Current read-only queue behavior

The queue is bound to the current active organization and branch via
`FOR UPDATE`, current session grants plus persisted current grants, current
department scopes, a distinct original author, the source type
`CONFIG_BUNDLE_REVIEW` and state `DRAFT`.

Before an entry is shown, the queue:

1. Identifies candidate batches from the bounded latest 100 flags (no
   source or live clinical/financial values leave the API).
2. Counts **all** staged rows in candidate batches, not just flagged rows.
   A maximum of `BUNDLE_REVIEW_MAX_ROWS` (5,000) total records may be
   materialized in one request, including all nested staged JSON.
   Batches exceeding the total budget are skipped and the existing
   `hasMore` flag is raised; omitted batches are never implicitly treated
   as verified. Rows with excess per-batch count also fail closed.
3. Reads the original source/normalized JSON, the validation-issue JSON,
   immutable keys, status and imported entity IDs from MariaDB in the
   same organization-locked `RepeatableRead` transaction. All rows
   are re-read and the observed row count must equal the earlier count.
   A count disagreement rejects the page with HTTP 409.
4. Verifies every included batch using
   `verifyIndependentExpertStage`: v2 HMAC over organization/batch/author,
   checksum, exact persisted batch source metadata, plus all rows; and
   verified+complete+atomic original export provenance. Missing key returns
   HTTP 503 rather than showing an unverifiable queue.
5. Exposes an expert flag only if its batch passed the gate, the flag
   was authored by the batch author, the current domain permissions remain
   valid, and the linked live master remains within reviewer scope.

The body remains a **metadata-only** list of flag event, batch, row number,
type, category, reason and timestamp. The full staged clinical/financial
payload is only read in the server-side transaction; it never appears in
the response or browser. No new database master write or approval path was
introduced, and source identity parity cannot confer professional authority.

## Test coverage

- `tests/f2-expert-queue-stage-guard.test.ts`: verifies rejection of
  changed staged value and a newly sealed but unqualified source; asserts
  complete row projection, bounded evidence read, gate-before-entries,
  response non-disclosure and read-only legacy commit safeguards.
- `tests/stage-54-catalog-expert-disposition.test.ts`: prior assumption
  about never reading JSON on the **server** was updated; it now requires
  a complete internal signed-stage verification without returning raw data.
- `tests/f2-review-batch-metadata-mariadb.integration.test.ts` already
  exercises the same independent expert stage gate with two MariaDB
  sessions and mutation/recovery of its actual stored rows and metadata.

## Remaining scope

Queue integrity is a procedural defense, **not** an approved policy for
foreign source-to-target mapping, versioned clinical/financial
configuration application, effective-dated price/reference-range
publication, professional signatory credentials, or re-export parity.
`CONFIG_BUNDLE_REVIEW` and `CSV_REVIEW` direct commits remain blocked.

F2 is IN PROGRESS; PR #334 stays DRAFT; `main` and Hostinger HOLD
remain unchanged. Browser UAT/F7 and F3 are not started.
