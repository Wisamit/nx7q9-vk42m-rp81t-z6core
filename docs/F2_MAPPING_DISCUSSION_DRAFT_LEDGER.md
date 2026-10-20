# F2 — Source / target mapping discussion draft ledger

## Status and intent

This F2 increment creates a **bounded audit discussion draft** for an individual
staged configuration-bundle row. It does NOT authorize mapping, foreign source
import, clinical or financial sign-off, release, price activation or write to
the catalog. Branch `f2-ten-class-policy-review-scope-gate`, Draft PR #334,
Hostinger HOLD. F2 IN PROGRESS, F3 not started.

## Author-scoped endpoints

On the existing `/api/catalog/imports/[id]/bundle-drift` route:

- `GET ?mappingDraftRow=<positive row number>`: inspect only the current
  author-owned batch row's latest mapping discussion. Return revision number,
  intent, whether the row's HMAC observation is still current, and whether
  the local target identity is merely observed. No source/live values, UUIDs,
  raw audit payloads, patient IDs or monetary amounts are returned.
- `POST ?mappingDraft=1`: accepts ONLY a bounded JSON object with
  `rowNumber`, `observationToken`, `expectedRevision` and
  `intent`, up to 768 bytes; no free text, target UUID, arbitrary value or
  clinical or tariff field is accepted. `intent` is one of
  `REQUEST_EXTERNAL_MAPPING`, `RETURN_TO_SOURCE_AUTHOR`, or
  `PROPOSE_LOCAL_RECONCILIATION`.

Existing tenant and branch lock (`organizations ... FOR UPDATE`) serializes
concurrent writers with the same organization. Session and persisted current
permissions, branch and department scopes, and every staged parent/master
visibility check run before any discussion is read or appended.

Both GET and POST now also require the **entire original staged v2 HMAC** and
verified, field-complete, transactionally consistent export. The exact
source/live `observationToken` must match current drift evidence before a
POST. A changed target makes the old draft **stale**, not a standing decision.

`PROPOSE_LOCAL_RECONCILIATION` may only be drafted when
`LOCAL_IDENTITY_OBSERVED` is currently true. Even this only means the
current locally visible UUID/natural-code/parent scope matches; source
installation lineage remains unproven. It is NEVER an approval or apply grant.

## Audit ledger

The route only appends an `AuditEvent` action
`CATALOG_BUNDLE_MAPPING_DISCUSSION_DRAFT_RECORDED` with exact
`CatalogImportRow` identity, current organization/branch, original batch
author, checksum, row index and entity type, selected intent, observation
HMAC, revision number, previous revision's digest, and a SHA-256 revision
digest **plus** a separate domain-separated `HMAC-SHA256` mapping-audit seal.
The SHA digest is a corruption indicator. The HMAC authenticates the audit
payload against the existing server-controlled signing key, so database-only
writers cannot silently invent new revision digests. Neither value is a
qualified professional signature, clinical/financial approval, independent
attestation or legal authority. Missing, malformed, old unsigned, wrong-key
or forged seals fail closed on the entire existing audit history. Audit actor and branch are
rechecked against every historical event; malformed or inconsistent events
fail closed, including older revisions.

- Optimistic `expectedRevision` rejects concurrent overwrite.
- Unchanged current draft intent is idempotent.
- New evidence produces a new draft revision; no historical draft is
  overwritten. A previous draft automatically becomes stale when target
  state changes.
- Every row's bounded full history (max 100 entries) is validated in
  append order with unique IDs, contiguous revisions, previous-digest links
  and a constant-time comparison of every revision's server-authenticated
  HMAC seal. Any gap, duplicate, wrong actor/branch/key, unsigned revision,
  forged SHA replacement, malformed field, additional property or overflow
  returns an error. The HMAC reuses the deployment's validated signing
  secret with a **distinct mapping-audit purpose prefix**, separate from
  staged bundle evidence and live-observation HMACs.
- Both endpoint responses explicitly have
  `reviewOnly:true`, `approved:false`,
  `mappingApproved:false`, `signingEnabled:false`,
  `activated:false`, `liveWrites:false`.

This audit is *not* a qualified versioned foreign-instance source-to-target
mapping. It does not store a target foreign ID, because the system does not yet
have independently verified source installation lineage or an approved
target-binding governance policy. Codes/names must not be used as portable IDs.

## Tests

- `tests/f2-mapping-discussion-draft.test.ts` validates audit record shape,
  digest chaining, actor/branch/checksum/tenant/row isolation, revision
  cap, malformed intents, tamper, wrong-key / unsigned HMAC seals,
  SHA recomputation attacks, staleness and non-approval static route
  guards.
- `tests/f2-mapping-discussion-mariadb.integration.test.ts` creates only
  synthetic organization/branches/users/DRAFT and appends audit revisions in
  one database session. Independent reader session validates historical
  authenticity constraints and refusal after branch/actor/payload mutation,
  including a forged re-digested revision signed under an attacker's key;
  restoration recovers the valid history. CI runs it with MariaDB.
- No modifications to any clinical, billing, released-result, tariff,
  reference-range, identity or migration table other than **synthetic CI
  fixtures**, and the append-only mapping discussion `AuditEvent`.

## F2 gates still blocked

A real installation identity trust chain, mapping external UUIDs to verified
local targets under branch/method/department/tariff scope, competent
medical/financial signatories with fresh re-authentication, and dedicated
transactional, versioned, reversible publish/apply with
export→approved apply→re-export parity all remain to be designed, approved
and tested. Human policy decisions remain `BLOCKED_EXTERNAL`; user/browser
QA and F7/F8 UAT remain deferred. Direct bundle/CSV review commits are
still forbidden.

## HMAC transition limitation

This checkpoint updates the still-unmerged **F2 Draft PR** ledger format.
Unsigned SHA-only mapping discussion entries from any prior test snapshots
are no longer accepted as verified records. There is no silent upgrade or
fabricated professional signature. A production deployment containing these
old draft events would need a separately reviewed migration/reconciliation
plan before this stricter reader could be enabled. No live data migration
or clinical/financial approval is performed here.
