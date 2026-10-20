# F2 — Two-package governed closure (no scope reduction)

**Binding context:** Issue #327, PR #334, master `02_MASTER_SCOPE.md` §87;
the 10 native catalog classes, multi-branch scoping, historical values and
qualified policy decisions remain in scope. The earlier five outstanding
tasks are reorganized into **two delivery packages inside F2**, not five
new F phases and not permission to bypass external evidence.

## Package A — Installation lineage and mapping reconciliation

Includes outstanding tasks 1 and the provenance/mapping prerequisites of
task 2.

1. Verify an independently obtained **original source installation identity**
   and export record provenance. Same organization UUID, current record code,
   a valid server HMAC and a locally compatible source UUID are **insufficient**.
   Only a source owner/vendor/authorized system-of-record evidence and
   approved cross-installation lineage policy can close this requirement.
2. Resolve each foreign source UUID → tenant-local immutable UUID mapping
   using authorized provenance and cardinality rules; never silently infer
   equality from names/codes, or overwrite protected clinical history.
3. Recheck full signed v2 review stage + each row's exact scoped ten-class
   live projection under the tenant lock and independent clinical/financial
   permission scopes.
4. Expose **read-only** normalized identity diagnostics, which exact top-level
   allowed fields differ, and how many differ, without showing values or
   bearer evidence. A matching local identity is only
   `LOCAL_IDENTITY_OBSERVED`, never an installation attestation.
5. Record correction requests via the separate review-only HMAC audit chain.
   Use revision/previousDigest, not MariaDB UUID/timestamp ordering.
6. Close the author/reviewer feedback loop: the author-only
   `GET /api/catalog/imports/:batchId/bundle-drift?mappingDraftRow=N`
   validates the whole independent feedback HMAC history before returning
   only `reviewerFeedbackRevision` and the categorical
   `reviewerFeedbackDisposition`. Disposition is null if no feedback exists,
   the author's signed draft was superseded, or its exact current live
   observation is stale. Corrupted reviewer history fails closed (409).
   Neither reviewer user IDs, source values nor HMAC material are returned.
   The author may draft a new correction but cannot impersonate the reviewer.

**Current software evidence:** `f2GovernedReadinessPreview` is invoked
strictly after `runIndependentMappingPreflight` verifies the complete DRAFT
source, author discussion HMAC, grants and actual live observation token.
It refuses partial source/live projections. Diagnostics are available in the
existing GET-only mapping-inspection `readiness.phaseOne` response. Source
identity remains `false` until external original-installation provenance
exists. **Package A operational exit: BLOCKED_EXTERNAL.**

## Package A — Ten-class full-batch read-only reconciliation (2026-10-20)

The independent **GET-only** mapping inspection, given a valid rowId, now
optionally returns `batchReconciliation` and
`batchReconciliationCoverage` **only** when the requester has BOTH
`catalog.reference_ranges.manage` and `pricing.manage` in the original
session AND currently persisted permissions, in addition to the existing
active organization/branch/department, independent actor and catalog grant
requirements. The whole signed v2 DRAFT source stage must validate first.

- `TEN_CLASS_COMPLETE`: a bounded, same-transaction, ten-class report is
  present. The report contains class counts, changed row counts, affected
  field **names**, mapping-required counts and explicit NO-APPLY flags.
  Foreign UUIDs, clinical and financial values, HMACs and author/reviewer
  identities are never returned in the report.
- `SOURCE_CLASS_INCOMPLETE`: the staged source did not contain all ten
  native classes. An otherwise valid partial bundle may still be inspected,
  but **cannot** be advertised as a ten-class closeout.
- `FULL_DOMAIN_SCOPE_REQUIRED`: independently scoped reviewer has only
  one domain's grants. The ordinary authorized row-level inspection remains
  available; whole-batch clinical/financial metadata is not disclosed.
- `NOT_REQUESTED`: author/reviewer POST and other non-closeout paths
  do not compute the expensive full-batch report.

The summary is calculated with `f2ReadOnlyBatchReconciliation` only
after `validatePolicyReviewBatchScope` rechecks the complete signed
source and after `readCatalogLiveObservations` reloads every in-scope
local target in the same locked `RepeatableRead` transaction. This reducer
rejects a missing class, duplicate type+ID, row ordinal gap/reorder,
unexpected or absent projection field, unknown class and changed
source/normalized/local ID. It never creates an apply plan, qualified
approval, provenance claim, reversal, clinical report or price update.

**This is evidence of source/local observation parity, not the real
export→approved apply→re-export test.** True cross-installation provenance
and qualified domain signatures remain external blockers.

## Package B — Qualified approvals, controlled apply/reversal and full parity

Includes remaining tasks 2, 3, 4 and 5:

1. Approved, versioned clinical and finance policy; independently credentialed
   humans, least-privilege branch scopes, MFA/signatory separation and
   documented effective dates. An administrator role or server-generated
   HMAC is not a substitute for a qualified human attestation.
2. Versioned, atomic, idempotent application with optimistic drift checks,
   per-record immutable clinical and monetary history, and transactionally
   consistent multi-branch scope. No destructive rewrite of released results
   or previously issued tariff snapshots.
3. Versioned compensating reversal/amendment retaining all audit/approval
   artifacts rather than deleting history. Medical ranges/prices must be
   governed by their respective qualified domains.
4. Real end-to-end ten-class **export → review → qualified approval → atomic
   apply → re-export**, verifying all source nested fields, prices as DECIMAL,
   clinical reference limits, composite memberships, organization/branch
   scopes and historical unchanged values. Include replay, wrong-tenant,
   permission revocation and concurrent updates.

**Current software evidence:** the existing GET-only
`readiness.phaseTwo` reports a fixed seven-item prerequisite checklist and
**`GOVERNED_APPLY_NOT_AUTHORIZED`**. It does not accept caller-supplied
approval flags, enable a POST apply, materialize source records, update a
master, authorize a signer, or claim round-trip parity. It is a preliminary
dry-run **not the requested operational apply implementation**. Until real
source lineage, signed policies and qualified approvals are provided, this
phase remains **BLOCKED_EXTERNAL / NOT EXECUTABLE**.

## Entry/exit discipline

- F2 stays **IN_PROGRESS**. No checklist item is marked complete merely
  because tests show a read-only HMAC or a synthetic simulation.
- Ordinary `CSV_REVIEW` / `CONFIG_BUNDLE_REVIEW` commit stays blocked.
- The independent GET is not a signature or clinical decision, and returns
  no source UUID, observed monetary/medical value, source checksum or HMAC.
- Verify the exact feature HEAD CI (TypeScript, ESLint, safety, real MariaDB
  and Next build). CI PASS cannot establish external source lineage or
  an independently qualified human approval.
- Keep PR #334 **OPEN/DRAFT**, `main` unchanged, Hostinger HOLD and
  **NO MERGE / DEPLOY / RESTART**. F7 browser acceptance only after F6;
  F8 remains NO_GO until UAT and independent clinical/finance/device/DR
  evidence.
