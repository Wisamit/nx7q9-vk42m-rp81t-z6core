# Stage 61 — Independent Policy Draft Review: Full-Batch Scope Gate

## Objective
Harden Stage 60 nonbinding clinical/financial procedural reviews against review-time tenant, branch, department and live-master scope drift. This does **not** implement signatory authority or make staged configuration effective.

## Implemented
- Before either GET preflight or POST audit append, inspect every staged row (maximum 5,000, reject a 5,001st row), not just the current queue or reviewer domain.
- Reject empty/changed batches, imported rows, unknown entity types, malformed/duplicate master identities, mismatched source/normalized IDs, invalid references and ungranted branch identities.
- Recheck the current tenant-scoped, branch/department-scoped **live** TEST, COMPONENT, UNIT, REFERENCE_INTERVAL, PRICE_LIST and PRICE_LIST_ITEM identities, including linked parent TEST/UNIT/COMPONENT/PRICE_LIST identities.
- Branch scope is the intersection of the original session scopes and live grants; a revoked branch or department cannot become accessible through refreshed grants during an existing session.
- Revalidation happens under the original active-organization row lock and same RepeatableRead transaction as the append-only procedural AuditEvent. Concurrent legitimate organization-locked operations serialize with the review.
- No staged JSON, patient data, price values or clinical range values are disclosed by the new scope guard. No master-table write, schema migration or report change.
- Both clinical and financial dispositions remain `PROCEDURAL_REVIEW_ONLY`, `approved=false`, `activated=false`, `signingEnabled=false`, `liveWrites=false`.

## Evidence
- `src/lib/catalog-policy-review-scope.ts`
- `src/app/api/catalog/imports/[id]/policy-review/route.ts`
- `tests/stage-61-policy-review-scope.test.ts`: parser/branch/price/duplicate/parent/immutability guards.
- `tests/stage-61-policy-review-scope-mariadb.integration.test.ts`: real MariaDB two-session staged rows, branch scope revocation, live department movement, tenant isolation, no applied staged master.
- `.github/workflows/ci.yml`: dedicated Stage 61 database regression; earlier tests retained.

## Boundaries and deferred acceptance
- The **review queue** remains a bounded metadata-only discovery facility; detail GET/POST now enforce whole-batch scope. No patient/source prices or reference values are returned by the queue.
- Existing Stage 59/60 proposal and audit revision formats remain unchanged for backward compatibility. Stage 61 does not claim cryptographic authentication of the SHA256 draft checksum.
- A reviewer cannot be the author; medical and financial reviewers must still be distinct. Review records cannot publish or sign.
- Policy signatories, MFA re-authentication requirements, branch delegation, legally applicable electronic-signature mechanism, effective-date application and approval of clinical ranges/prices remain **BLOCKED until explicit owner/authorized governance decisions**.
- Hardware, operational, clinician/cashier, security penetration and production clinical acceptance remain **DEFERRED until the entire system has been implemented**; automated CI is engineering evidence only.
- No migrations; no data backfill and no historical clinical/financial records changed. Hostinger deployment requires independent owner confirmation after merged `main` CI succeeds.
