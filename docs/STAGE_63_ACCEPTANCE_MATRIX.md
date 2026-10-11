# Stage 63 — Bounded Policy-Draft Audit Revision Continuity

## Objective
Prevent a seemingly valid **latest** unsigned policy draft from concealing missing, duplicated, forged, corrupted or unauthorized **earlier** draft revisions. Protect the author's current-revision feedback and independent reviewer decisions without enabling signatures or clinical/financial changes.

## Implemented
- `src/lib/catalog-policy-draft-history.ts`: strict, fail-closed audit-chain parser: 1–1,000 consecutive revisions, unique audit event IDs, unique revisions, original batch author on every revision, exact organization/branch/batch/source-checksum binding, SHA256 proposal-digest integrity and unchanged disabled approval flags. Reconcile the highest revision with the latest event selected by `occurredAt DESC, id DESC`. Handle equal-millisecond predecessor timestamps without trusting their lexical ID order.
- `src/app/api/catalog/imports/[id]/bundle-drift/route.ts`: author-only governance and policy-draft save now load all revisions (with a 1,001-row overflow sentinel) under existing live tenant/branch/department/full-batch permission checks and organization row lock. A poisoned earlier event returns 409 and prevents both reading and adding revisions. Immutable append-only audit preserved. A stale `expectedRevision` returns 409; revision 1,001 returns a controlled 409, but an unchanged draft at revision 1,000 remains idempotent.
- `src/app/api/catalog/imports/[id]/policy-review/route.ts`: independent medical/financial preflight and review append use the same bounded history-integrity check, not only the newest event. Reviewer permission/scope/author separation and Stage 61 whole-batch scope checks remain mandatory before a review is logged.
- `tests/stage-63-policy-draft-history.test.ts`: empty, valid/invalid, actor spoofing, gaps, duplicate, changed checksum, timestamp collision, cap and server-path controls.
- `tests/stage-63-policy-draft-history-mariadb.integration.test.ts`: real two-connection MariaDB draft and audit, organization row locking, CAS stale-version rejection, foreign tenant isolation and historical forged-actor detection, no clinical master writes.
- `.github/workflows/ci.yml`: Stage 63 MariaDB integration gate alongside all earlier safety/regression tests.

## Limitations and deferred gates
- This is **structural integrity verification**, not a cryptographic, legally valid electronic signature. An attacker with privileged direct database write could forge an internally consistent entire audit history; DB access control, backups and independent audit immutability remain required.
- The independent review discovery queue remains bounded and metadata-only; it may list a candidate whose chain is later rejected by the detail preflight. Review/author detail functions fail closed before exposing proposal details or writing decisions.
- `UNAPPROVED_DRAFT`, `PROCEDURAL_REVIEW_ONLY`, `approved=false`, `signingEnabled=false`, `activated=false` and `liveWrites=false` remain mandatory. No approval, no price publication, no range activation, no patient-report updates, no migration or raw source disclosure.
- Human signing appointments, MFA reauthentication, legally trusted electronic-signature governance, final price/range authorization, operational lab/hardware testing and full clinical/financial UAT remain blocked or deferred pending explicit approvals/completion of the LIS.
- Hostinger publication requires independent merged-main exact-SHA CI SUCCESS and owner deployment confirmation.
