# F2 — Independent source/target mapping discussion inspection

## Purpose

A signed, author-owned mapping discussion is not an approved foreign UUID
remap, and a valid historical observation cannot establish live freshness.
This checkpoint adds a **GET-only**, independent domain-scoped inspection of
an *already recorded* mapping discussion, without providing an action to
endorse, approve, reassign or publish anything.

Endpoint:
`GET /api/catalog/imports/:batchId/mapping-inspection?rowId=:rowUuid`

## Exact fail-closed preflight

The route requires an active authenticated reviewer *other than the batch
author*, explicit current organization and active-branch scope, **both**
original session and freshly persisted permission grants, and an applicable
clinical/financial/composite domain review grant.

Within a tenant organization lock (`FOR UPDATE`, `RepeatableRead`) it:

1. Reads a bounded DRAFT batch and the exact requested staged row in the
   current organization.
2. Revalidates all staged rows, the **full v2 HMAC**, authenticated original
   transactional/field-complete source and *all scoped live master identities*
   using `validatePolicyReviewBatchScope`. Branch, department, panel/package
   membership, clinical reference interval and tariff identity boundaries
   must remain reviewable; failures are opaque. It never returns staged
   source, normalized JSON, live values, prices or clinical intervals.
3. Reads every bounded audit revision for that row (max 100 + 1), not just
   the last one; validates the full HMAC-authenticated history, author/branch
   identity, original checksum, previous digest links and strict latest
   revision. Any malformed, altered, unsigned or wrong-key revision fails
   closed; a row with no discussion returns not-found.
4. Returns only categorical domain, draft revision, the author's intent
   and constant non-authorization flags. The same internal
   `triagePermissionScope` covers all ten native types; panel/package
   reviews require both clinical and financial management grants.

The independent reader now uses the **same full Prisma SELECT projection** as
the author drift endpoint for all ten native classes, through
`readCatalogLiveObservations`. Both run scoped under the organization lock
and `RepeatableRead`. The reviewer loads the exact DRAFT row and computes
`catalogDriftObservationToken(secret, sourceChecksum, rowNumber, entityType,
sourceData, currentLiveJSON)` with the original algorithm. Constant-time
token comparison must match the latest fully HMAC-authenticated author
discussion revision. There is no approximate subset or reserialization of
selected columns separate from the author route.

When the scoped target is absent, a linked membership/branch becomes
unreviewable, or any full projected value changes, the endpoint returns an
opaque **409**, not a "fresh" observation. Its read-only result after exact
match is:

- `status: "INDEPENDENT_FRESH_OBSERVATION_INSPECTION_ONLY"`
- `historicalObservationMatchesDraft: true`
- `currentLiveObservationRevalidated: true` (**exact token parity only**)
- `independentMappingApprovalEligible: false`
- `sourceInstanceProven: false`
- `mappingApproved: false`, `signingEnabled: false`,
  `approved: false`, `activated: false`, `liveWrites: false`,
  `reviewOnly: true`

**Precision of the claim:** this is fresh parity to the existing Stage 50/51
author-side observation projection. It cannot detect fields that neither
author drift SELECT nor the signed source covered, and cannot establish
original installation lineage, qualified medical/financial signatory consent,
approved foreign UUID remaps or any versioned apply authority. A manager
grant or server HMAC remains review evidence only. Full live parity is also
transaction-snapshot scoped; concurrent external writers that bypass the
organization serialization protocol may commit afterward. Any future apply
must revalidate inside its separate qualified atomic write transaction.

**No clinical/financial import application is enabled.** Direct
`CONFIG_BUNDLE_REVIEW` and `CSV_REVIEW` commit denial remains in force.


## Tests

- `tests/f2-mapping-independent-inspection.test.ts`: all 10 native classes;
  clinical vs financial vs cross-domain permissions, current privilege
  revocation, author separation, unknown types, exact metadata-only
  flags, and static validation of the GET-only route and whole-stage scope.
- `tests/f2-mapping-discussion-mariadb.integration.test.ts`: the existing
  independently connected SQL writer/reader, HMAC tamper and restore tests
  also verify metadata-only independent preflight cannot be performed by the
  original author or by a reviewer whose domain grant was revoked.

- `tests/f2-mapping-live-observation-mariadb.integration.test.ts`:
  Prisma shared full-select projections for all 10 types with synthetic
  MariaDB masters; signed author token parity followed by ten distinct
  live modifications (including panel/package membership, reference
  decimal and both tariff decimals), stale-token rejection, revoked branch
  and foreign-tenant denial. Runs explicitly in CI.

No schema migration, new medical/financial master writes, approval event or
clinical report changes. Direct `CONFIG_BUNDLE_REVIEW` and `CSV_REVIEW`
commit paths remain blocked.

F2 remains **IN PROGRESS**. Qualified human clinical and financial sign-off
is **BLOCKED_EXTERNAL**. Approved foreign source/target remapping, source
installation lineage, atomic versioned apply/corrective reversal, and complete
export→approved apply→re-export parity remain unimplemented. Draft PR #334
is not mergeable; Hostinger HOLD / NO MERGE / NO DEPLOY / NO RESTART.
