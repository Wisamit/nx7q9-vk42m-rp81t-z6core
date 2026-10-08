# Stage 6 — Specimen Operations Completion: Current-Code Delta Audit

Status: INITIAL / IN PROGRESS. Do not interpret unverified items as missing.
Base production merge: `a77c993d8be09e4436976613204a2f3a3f9276fe` (Stage 5; Hostinger confirmed by owner).
Scope source: `02_MASTER_SCOPE.md` sections 20–28, with related specimen security, audit, and multi-branch requirements.

## Verified current implementations

- `src/app/api/specimens/[id]/aliquots/route.ts`: creates child specimens with `parentSpecimenId`, `parentRelationType=ALIQUOT`, independent barcodes, tracked volume depletion, event and audit records, and linked order items.
- `src/app/api/specimens/[id]/usage/route.ts`: records usage and remaining volume with optimistic preanalytical version checking and audit.
- `src/app/api/specimens/[id]/storage-location/route.ts`: audits storage relocation, with reason and branch authorization; storage is currently a free-text location.
- `src/app/specimens/[id]/label/page.tsx` and label-print API: render Code 128 labels, print/reprint audit and safety checks; multiple predefined label sizes.
- `src/app/specimens/scan/page.tsx`: exact-barcode scan station, branch-filtered retrieval, specimen lifecycle and aliquot management UI.
- `src/app/api/specimens/[id]/actions/route.ts`: recorded receiving user, time, conditions, label and container assessments, temperature and discrepancy details with specimen and audit events.
- `src/app/api/specimens/[id]/rejections/route.ts`: configured whole-specimen/selected-test rejection, safeguards for existing analytical work and active derived aliquots, and linked recollection using stored order-time requirements.
- Dedicated collection-attempts, volume-reconcile and specimen rejection reason configuration routes also exist; inspect behavior and regression tests in the full audit.

## Safety-first verification targets

1. **Reception discrepancy workflow**: `receptionAssessmentError()` currently requires discrepancy details but does not itself block `UNLABELED`/`MISMATCHED` or unacceptable condition from entering `RECEIVED`; receiving route updates the specimen status to `RECEIVED`. Determine whether processing is held elsewhere, or whether governed quarantine/exception handling is a real safety gap. Do not silently auto-release a disputed specimen.
2. **Storage lifecycle and location hierarchy**: establish whether free-text storage is enough for the required tracked freezer/fridge/rack/slot chain and retrieval/disposal policy; evaluate current lineage and audit.
3. **Scanner/print acceptance**: inspect input behavior, duplicate/reprint controls, barcode uniqueness, and real printer/scanner acceptance scenarios.
4. **Aliquot lifecycle**: verify child status transitions, nested lineage, transfer, rejection, and physical labels with real test coverage.
5. **Receiving context and custody**: verify branch transitions, transfer manifest boundaries, expected-versus-received reconciliation and test-level permissions; distinguish Stage 6 scope from Stage 9 full inter-branch logistics.
6. **Selective recollection**: verify impacted order items, original/replacement traceability, outstanding result/worklist holds and old snapshot integrity.

## Implementation constraints

- No rebuild of Stage 3 order-time specimen requirement snapshots.
- Verify gaps against latest code and `02_MASTER_SCOPE.md`; previous audit files are reference only.
- Preserve historical records and audit all clinically important transitions.
- For each Part: implementation + migration if needed + bilingual UI + safety tests + full CI on current head.
- Keep one Draft PR; no individual Part merge or production deploy.
