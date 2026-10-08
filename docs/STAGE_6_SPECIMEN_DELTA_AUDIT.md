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

## Stage 6 implementation checkpoints (2026-10-08)

- **Order-time demographics:** sex, DOB and recorded age captured as immutable order snapshots; reference interval evaluation at order time, with absent historical evidence handled conservatively.
- **Reception:** unsafe label/condition/container assessments do not enter RECEIVED, and denied reception exceptions are audit logged. Controlled quarantine/exception adjudication remains a distinct follow-up requirement.
- **Aliquots and material:** parent lineage, independent barcodes and exact-volume usage exist; new aliquot creation blocks closed orders and parents without active linked tests; reconciliation cannot recreate already consumed specimen volume.
- **Rejection and recollection:** whole/selected-test safeguards, replacement genealogy and requirement snapshots exist. Source custody, order status and active child links now rechecked transactionally. Successful and failed collection paths verify active order and current branch inside atomic state changes.
- **Interbranch custody:** manifest DISPATCH and RECEIVE_ITEM operations now claim source statuses atomically, avoiding concurrent duplicate dispatch/receipt.
- **Remaining acceptance work:** end-to-end multi-operator race integration tests on MariaDB, exceptional specimen quarantine/clinical release policy, physical storage hierarchy and disposal controls, hardware scanner/label validation, and final Stage 6 / Stage 9 scope allocation. CI success is not equivalent to operational acceptance.
- **Status:** Stage 6 remains Draft, not yet merged or deployed to Hostinger.

## Part 11 — Rejected-sample disposal (CI #611)

- Rejected-only physical disposal is available through a bilingual operator action and audited endpoint; mandatory reason, scoped authorization, branch custody CAS, active aliquot guard, lifecycle event and immutable audit evidence.
- Clinical retention/disposal for received, processed or released-result specimens is **not** authorized by this feature; requires explicit documented retention and approval policy. Hierarchical cold storage / slot allocation also remains open.
- CI #611 SUCCESS on `172cd7374c69d7e0de8c386d15df708aa3fda067` before this documentation update. Final branch CI must be rerun for the current head.


## Checkpoint — Storage authorization and patient age bounds (2026-10-08)

- Restricted inactive storage master listings to `settings.manage`; ordinary `specimens.view` receives active locations only, including scanner views.
- Added status PATCH duplicate-submit guard, network error handling and refresh failure feedback in bilingual specimen UI.
- Corrected patient create/edit recorded age parsing: decimal integer input accepts 0–54787 days, 0–1800 months, or 0–150 years. UI maximum follows the selected unit. Existing historical demographic snapshots are unchanged.
- Added source regression guards in `tests/specimen-storage-location.test.ts` and `tests/patient-recorded-age-bounds.test.ts`.
- **Still open / acceptance blocked:** exact FK-backed physical occupancy and location history; safe concurrent activation/deactivation and assignment proved with real MariaDB tests; nonconformance quarantine; retention/disposal governance; Stage 6 end-to-end specimen/barcode and bilingual operational acceptance. Existing checks include source-pattern assertions and do not demonstrate race-free runtime behavior.
- This checkpoint does **not** authorize Stage 6 merge, Hostinger deployment, or Stage 7. CI outcome must be recorded against the current HEAD.


## Storage location lock-order hardening (2026-10-08)

- Relocation now obtains an InnoDB `SELECT ... FOR UPDATE` lock on the selected ACTIVE branch-scoped `specimen_storage_locations` record **before** mutating the specimen. Deactivation takes the corresponding location UPDATE lock before counting occupants, so the two entry points serialize on the same location record.
- Locking the row via SELECT avoids writing an unchanged status value merely to acquire a lock. It also ensures a concurrently deactivated destination returns a conflict rather than silently accepting the move.
- Source regression checks lock ordering. **This is not a claim of full concurrency acceptance**: add real MariaDB two-connection tests and account for legacy free-text location assignments and every other specimen status/branch transition.
- Existing transfers may leave a stale path during IN_TRANSIT. Physical custody and storage occupancy must be explicitly modeled before declaring exact occupancy, implementing the nullable `storageLocationId` FK and migrated location history without guessing mappings for existing specimens.
- Stage 6 remains Draft and acceptance-blocked; no merge or production deployment.


## Registered storage reference and transfer custody checkpoint

- Added nullable `specimens.storage_location_id` FK to the branch storage master. The migration deliberately does **not** backfill unverified legacy free-text paths.
- Physical relocation now records both registered location ID and path snapshot and audits previous ID/path.
- Deactivation occupancy checks explicit IDs plus unmatched historical text conservatively, including non-disposed material regardless of workflow state; an exact physical-location inventory has **not** yet been proven.
- Manifest dispatch and destination receipt clear *current* path and registered FK atomically with the specimen status transition. The dispatch event retains prior path/ID for audit and chain of custody.
- **Acceptance blockers**: MariaDB concurrent integration tests for every storage/transfer transition; reconciliation policy for historical unlinked paths; clarify quarantined, rejected, and physically retained specimens, as well as retention/disposal policy. Physical scanner/printer checks remain outstanding.
- No historical patient/result/financial backfill. No Stage 6 merge or Hostinger deployment.
