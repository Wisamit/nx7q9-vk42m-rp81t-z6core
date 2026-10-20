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

The response **always** includes:

- `status: "INDEPENDENT_DISCUSSION_INSPECTION_ONLY"`
- `historicalObservationMatchesDraft: true`
- `currentLiveObservationRevalidated: false`
- `independentMappingApprovalEligible: false`
- `sourceInstanceProven: false`
- `mappingApproved: false`, `signingEnabled: false`,
  `approved: false`, `activated: false`, `liveWrites: false`,
  `reviewOnly: true`

The response **does NOT claim live drift observation-token parity**. The
whole-batch source/live policy review scope check covers the existing
identity and selected clinical/financial snapshots, but does not recompute
the exact author-side live observation token for each projected field.
Consequently, this is strictly **historical discussion inspection**, not
"current mapping verified", not qualified signatory evidence, and never a
production apply prerequisite. If a stronger workflow is designed later,
it must independently recalculate the complete live observation and enforce
professionally approved mapping/signature policies.

## Tests

- `tests/f2-mapping-independent-inspection.test.ts`: all 10 native classes;
  clinical vs financial vs cross-domain permissions, current privilege
  revocation, author separation, unknown types, exact metadata-only
  flags, and static validation of the GET-only route and whole-stage scope.
- `tests/f2-mapping-discussion-mariadb.integration.test.ts`: the existing
  independently connected SQL writer/reader, HMAC tamper and restore tests
  also verify metadata-only independent preflight cannot be performed by the
  original author or by a reviewer whose domain grant was revoked.

No schema migration, new medical/financial master writes, approval event or
clinical report changes. Direct `CONFIG_BUNDLE_REVIEW` and `CSV_REVIEW`
commit paths remain blocked.

F2 remains **IN PROGRESS**. Qualified human clinical and financial sign-off
is **BLOCKED_EXTERNAL**. Approved foreign source/target remapping, source
installation lineage, atomic versioned apply/corrective reversal, and complete
export→approved apply→re-export parity remain unimplemented. Draft PR #334
is not mergeable; Hostinger HOLD / NO MERGE / NO DEPLOY / NO RESTART.
