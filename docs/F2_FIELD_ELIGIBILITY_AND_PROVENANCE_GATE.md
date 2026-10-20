# F2 — Field eligibility classification and independent source provenance

## Boundary / status

This is a **review-only engineering foundation**, NOT an approved ten-class
application contract, signing policy, migration, or clinical/financial GO.
No operational catalog or tariff data are updated by this increment.
`CONFIG_BUNDLE_REVIEW` and `CSV_REVIEW` remain intentionally
non-committable in the legacy commit route.

## Distinguish two cryptographic facts

1. A server HMAC over the persisted DRAFT (v2) authenticates **staging**
   rows and metadata, not the original export's professional authority.
2. An independently inspectable source for the policy reviewer and queue
   now also requires **all three** captured claims: original bundle attestation
   `VERIFIED`, field contract `COMPLETE_SOURCE_FIELD_PROJECTION`, and
   `transactional-consistent-read` snapshot consistency. This gate is
   checked **after** verifying the v2 persisted seal under the existing
   organization-locked reviewer transaction.
3. An unsigned, legacy/no-field-contract or paginated export can still be
   staged safely for author diagnostics, but cannot be presented as eligible
   for **independent policy review**. Even a valid new HMAC of such staging
   fails with `policy_review_unverified_source` (or is hidden from queue).
   Tampered staging fails with `policy_review_source_integrity_error`.
   A compromised signing key, external professional identity, and
   original source-owner authorization are not solved by either check.

## Complete top-level source classification (ten export classes)

`src/lib/catalog-field-review-eligibility.ts` names the **entire exact**
source field vocabulary via explicit, disjoint security groupings:

| Field group | Treatment in review | Examples |
| --- | --- | --- |
| `IMMUTABLE_SYSTEM` | Never take from import as a new live value | `id`, `createdAt`, `updatedAt`, `approvedAt`, `retiredAt` |
| `IDENTITY_RECONCILIATION` | Needs same/foreign-instance identity and tenant/branch mapping | `code`, `branchId`, `departmentId`, `testId`, `unitId`, `items`, parent `priceList`, `currency`, private client IDs |
| `CLINICAL_VERSIONED_REVIEW` | Qualified clinical decision + effective-dated versioning | Test/component descriptions, specimen conditions, units, interval bounds, flags, normal text |
| `FINANCIAL_VERSIONED_REVIEW` | Qualified financial decision + effective-dated versioning | Price, price-list identity fields not marked as mappings, effective windows |
| `CROSS_DOMAIN_VERSIONED_REVIEW` | Clinical and financial decisions, future versioned publication | Panel/package descriptions/status |
| `UNMAPPED_BLOCKED` | Not part of the contract; reject any inferred authorization | Unknown/forged fields and paths |

This is **risk triage**, not permission. In particular, status, currency,
symbol, range and price changes may require a new version or different target
mapping depending on the actual approved business/clinical policy; the
classification does not decide that policy.

The contract is checked against `catalogBundleAllowedSourceFields`;
missing/duplicated/unclassified field declarations fail automated tests.
Nested paths are recognized only from the exact signed nested source
projection (including composite member array indexes). A path missing from
that projection is `UNMAPPED_BLOCKED`; capped observations remain
`completeFieldInventory: false`. The API returns only **field names and
risk labels**, never original/live clinical or financial values.

Every reported `fieldReview` carries `reviewOnly: true`,
`autoApplyAllowed: false`, `qualifiedApprovalRequired: true`, and
`versionedApplicationRequired: true`. Browser UI validates this and
renders bilingual classification labels. This data structure cannot authorize
live database writes and is not used in any live commit path.

## Required F2 next gates

- Approved **per-field** eligibility and target-identity mapping policy,
  distinguishing same-instance IDs from foreign-instance reconciliation;
  ambiguity must remain `BLOCKED_EXTERNAL`.
- Qualified independent medical/finance/composite signatory authority,
  branch/department scopes, re-authentication and revocation policy.
- A distinct, signed, atomic, transactionally versioned apply/corrective
  reversal route with original-before/new-after evidence and idempotency.
- MariaDB positive and negative export→stage→approved apply→re-export
  parity across each authorized target field and the ten export classes.
- History and audit preserved for released clinical reports and invoices.
  No retrospective recomputation of historical prices or reference ranges.
- Hostinger service recovery and **explicit owner authorization** before
  any merge/deploy; F7 browser QA and F8 qualified UAT remain deferred.

## Verification

- `tests/f2-field-review-eligibility.test.ts`: complete field taxonomy,
  nested paths, unknown/malformed paths, capped diffs, no-auto-apply guards.
- `tests/f2-ten-class-policy-review-scope.test.ts`: valid re-signed
  unverified, legacy and non-atomic source variants rejected despite intact
  persisted staging HMAC.
- `tests/f2-review-batch-metadata-mariadb.integration.test.ts`: two
  independent sessions prove database-read HMAC vs original source
  qualification are separate facts, plus tamper/restore negatives.
- Exact GitHub feature-head CI must be checked before reporting PASS.
