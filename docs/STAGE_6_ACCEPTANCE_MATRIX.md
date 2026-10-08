# Stage 6 — Specimen Operations Acceptance Matrix

Status: **NOT ACCEPTED — Draft PR #124; no merge or Hostinger deployment**.

This is an evidence-oriented checklist, not a statement of completed acceptance. The authoritative feature scope remains `02_MASTER_SCOPE.md` sections 20–28; outstanding Stage 9 logistics must be tracked without silently removing Stage 6 specimen-custody essentials.

| ID | Acceptance scenario | Existing evidence | Current status | Final required evidence |
|---|---|---|---|---|
| S6-01 | Reception: positive exact barcode/label/container and acceptable specimen condition | Reception guard, assessment and audit route; policy tests | Implemented, operationally unverified | Operator E2E positive flow in both locales |
| S6-02 | Reception: mislabeled, unlabeled, wrong container, unacceptable condition | Fail-closed acceptance and exception audit | Partial | Clinically approved quarantine/hold and adjudication; no implicit processing or release |
| S6-03 | Collection attempt/recollection preserves original specimen and clinical snapshots | Collection/rejection routes and safety regressions | Partial | Multi-operator E2E and source-to-replacement audit verification |
| S6-04 | Parent/child aliquot barcode lineage, exact volume and usage | Aliquot/usage CAS; volume tests | Partial | Real MariaDB multi-operator duplicate/overuse race and barcode printing |
| S6-05 | Branch-scoped registered zone/unit/rack/slot storage | Nullable FK and master; active-location lock | Partial | Branch authorization E2E, legacy unlinked locations adjudication, physical location audits |
| S6-06 | Storage relocation vs deactivation races | Two-connection MariaDB row lock and occupancy tests | Partial | Concurrent authenticated API transitions with real specimen, row and audit assertions |
| S6-07 | Interbranch dispatch and receive chain of custody | Manifest CAS, custody snapshots; clears stale storage on dispatch | Partial | Two-branch E2E, manifest reconciliation, missing/damaged specimen handling |
| S6-08 | Rejected specimen disposal retains audit and releases occupancy | Rejected-only disposal, event/audit, clear FK | Partial | Approved disposal authority/signoff; real retention policy for non-rejected clinical specimens |
| S6-09 | Scanner workflow, label printer, reprint and audit | Scan screen, label API and tests | Partial | Real hardware: scanner keyboard wedge, duplicate scans, label sizes, printer and reprint |
| S6-10 | Clinical retention, hold/quarantine, authorized release or disposal | Conservative fail-closed disposal only | **BLOCKED** | Lab director-approved policy with effective dates, roles, reasons and acknowledgment |
| S6-11 | Bilingual RTL/LTR workflows, branch permission leakage tests | UI, i18n and safety checks | Partial | Operator signoff in Arabic and English across distinct branches |
| S6-12 | CI, migrations, and release readiness | GitHub CI validation and migration checks | In progress | Successful CI on exact final SHA, migration rehearsal, backup/rollback/restore plan |

## Non-negotiable completion gates

1. Do **not** close Stage 6 while S6-02, S6-06, S6-07, S6-09 or S6-10 remain unaccepted.
2. Do **not** infer or backfill historical `storage_location_id` values from unverified free text.
3. Do **not** invent clinical quarantine/disposal timelines or authorities. These require explicit laboratory policy approval.
4. For each failure case: ensure the state transition fails closed, preserves immutable historical context, and writes an auditable decision or exceptional observation.
5. Capture acceptance evidence: actor, branch, barcode/manifest, expected vs actual, timestamp, screenshot/log reference, version/SHA, reviewer and outcome.
6. Stage 6 can be considered **engineering-complete** only after final-schema migrations, all required automated tests and current-SHA CI pass; **accepted** only after clinical and operational signoff. Neither is currently asserted.

## Release guard

Keep `stage-6-specimen-operations-completion` and PR #124 in Draft; no merge, no Hostinger deployment, no Stage 7 work before explicit owner approval.

## Integration evidence improvement

- The MariaDB two-connection test now performs a real guarded `specimens.preanalytical_version` compare-and-swap update in the same transaction that holds the destination storage-row lock. The competing deactivation must time out until the source transaction commits.
- This increases database-level evidence for specimen CAS and master-row serialization together; it is still **not** an authenticated concurrent API test or a signed-off clinical/hardware procedure. The statuses above remain unchanged until those acceptance records exist.

## Barcode label reprint race hardening

- The specimen label-print endpoint now acquires an InnoDB `FOR UPDATE` lock on the organization-scoped specimen before counting prior prints, evaluating the mandatory reprint reason, and inserting the audit record in one transaction. Concurrent print requests cannot both pass as an unaudited first print.
- Added source regression for lock/count/policy/audit ordering. Physical printer delivery is **not** guaranteed by an HTTP audit acknowledgment, so real printer, label and retry acceptance still requires in-lab observation.

## Final print-policy consistency checkpoint

- The label endpoint now reads the **current specimen status from its locked database row** and uses that value both for the print policy and audit. This avoids a stale pre-lock specimen status being accepted after a concurrent state transition.
- The final deploy gate continues to require CI success on the exact HEAD, documented clinical hold and retention policy approval, barcode hardware testing and operational sign-off. Automated tests alone must not be labeled as complete field acceptance.

## Print custody consistency

- The locked specimen row now returns current branch custody as well as status. The print audit transaction rejects unauthorized current-branch custody changes that occurred after the initial lookup. Historic ordering-branch access alone does not override a known inaccessible current custody branch.
- Continue to require hardware label-print validation and final CI at current HEAD before the Stage 6 release gate.

## Distinct-barcode concurrent receipt consistency

- Item receipts now lock the parent manifest row with `FOR UPDATE` before claiming an individual barcode and computing remaining unreceived items. Concurrent operators receiving different barcodes serialize, preventing a stale `PARTIALLY_RECEIVED` manifest after all items have been received.
- Added source-level lock-order regression. Actual simultaneous authenticated two-branch receipt API acceptance remains required before operational signoff.

## MariaDB manifest receipt concurrency coverage

- Added a dedicated two-connection MariaDB test with organization, branch, user, patient, order, two distinct barcoded specimens, transfer manifest and two manifest items. It verifies locking the parent manifest blocks a competing receiver, followed by an authoritative remaining-item count and transition from `PARTIALLY_RECEIVED` to `RECEIVED` when both barcodes have arrived.
- Added this regression to CI after migrations. It proves the database locking sequence on real records; authenticated HTTP and real interbranch hardware/operator acceptance still require evidence. Test completion remains pending final CI on exact SHA.

## Two-branch custody assertions

- The manifest concurrency integration fixture now uses **distinct source and destination branches**, real two-specimen optimistic CAS state changes (`IN_TRANSIT` to `RECEIVED`, source to destination), and asserts both specimen custody records together with final manifest completion. No shortcuts using a source==destination fixture.
- Live authenticated end-to-end operator acceptance and clinical retention/quarantine policy are still outstanding; database integration alone is not an operational release signoff.

## Exact barcode scan custody privacy

- Scanning a known barcode now resolves patient/specimen details only when its **current custody branch** is in the user's active branch scopes. Access to the historical ordering branch alone cannot expose a transferred specimen in another branch.
- Added source regression and explicit dispatch/receipt action-enum validation. Multi-branch authenticated E2E review remains required.
