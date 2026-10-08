# Stage 6 — Specimen Operations Acceptance Matrix

Status: **NOT ACCEPTED — Draft PR #124; no merge or Hostinger deployment**.

This is an evidence-oriented checklist, not a statement of completed acceptance. The authoritative feature scope remains `02_MASTER_SCOPE.md` sections 20–28; outstanding Stage 9 logistics must be tracked without silently removing Stage 6 specimen-custody essentials.

| ID | Acceptance scenario | Existing evidence | Current status | Final required evidence |
|---|---|---|---|---|
| S6-01 | Reception: positive exact barcode/label/container and acceptable specimen condition | Reception guard, assessment and audit route; policy tests | Implemented, operationally unverified | Operator E2E positive flow in both locales |
| S6-02 | Reception: mislabeled, unlabeled, wrong container, unacceptable condition | Atomic persisted QUARANTINED state, event/audit and result release hold | Implemented, automated/clinical acceptance pending | Confirm migration + CI, deferred clinical review of approved override/adjudication policy; no implicit processing or release |
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

1. Do **not** assert Stage 6 **clinical / operational go-live acceptance** while S6-02, S6-06, S6-07, S6-09 or S6-10 remain unaccepted. Automated engineering completion and a guarded deployment candidate may be recorded separately when the exact-HEAD evidence passes; S6-09 hardware/manual UI remains DEFERRED to whole-project UAT at owner direction.
2. Do **not** infer or backfill historical `storage_location_id` values from unverified free text.
3. Do **not** invent clinical quarantine/disposal timelines or authorities. These require explicit laboratory policy approval.
4. For each failure case: ensure the state transition fails closed, preserves immutable historical context, and writes an auditable decision or exceptional observation.
5. Capture acceptance evidence: actor, branch, barcode/manifest, expected vs actual, timestamp, screenshot/log reference, version/SHA, reviewer and outcome.
6. Stage 6 can be considered **engineering-complete** only after final-schema migrations, all required automated tests and current-SHA CI pass; **clinically operationally accepted** only after deferred system-wide UAT and relevant clinical signoff. Neither is currently asserted.

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

## Transfer source-custody CAS safeguard

- Manifest item receipt now enforces organization and the manifest's source branch in the optimistic `IN_TRANSIT` specimen claim, rather than copying an untrusted/stale specimen current branch into the predicate. This rejects inconsistent custody that could otherwise be reassigned to the destination.
- Added a source regression. Final CI on exact HEAD, authenticated multi-branch acceptance, clinically approved hold/retention policy and hardware validation remain required.

## Release readiness versus deferred operator UAT (owner direction)

- Owner defers **all manual UI and connected hardware testing until the full project is built**. Do not block individual Stage 6 *engineering-complete / deployment-candidate* status solely on immediate manual UI or printer/scanner testing; keep them explicitly **DEFERRED TO FULL-PROJECT UAT**, not passed.
- The Stage 6 deployment-candidate gate still requires all automated checks, MariaDB migrations and integration fixtures, access control and failure-mode safety checks on the exact HEAD, and a documented rollback/backup rehearsal plan. Any clinical quarantine and retention/disposal operations lacking laboratory-approved policy must remain fail-closed, with no invented times, approvals or implicit result release.
- Deferring UAT does not establish clinical operational go-live approval. Production activation of clinically sensitive actions requires applicable policy authorization and the later system-wide UAT.
- The source acceptance matrix rows describing operator hardware acceptance must be read as **deferred verification**, not missing implementation to be filled by claiming tests passed.

## Manifest creation contention guard

- Concurrent creation of active transfer manifests for overlapping specimens is now serialized via stable-order InnoDB specimen row locks, with active-manifest membership rechecked inside the same transaction before manifest/item insertion. Stale specimen state or conflicting membership produces HTTP 409 rather than duplicate active manifests.
- Added a source regression for stable lock order, transactional membership recheck and fail-closed conflict response. MariaDB/API race acceptance should separately exercise concurrent manifest POSTs.


## Fail-closed pre-analytical clinical quarantine (engineering implementation)

- Unacceptable reception observations (label mismatch/unlabeled, unacceptable condition, container mismatch) now atomically transition the specimen from its current receivable state to `QUARANTINED`, increment the pre-analytical CAS version, and persist the actual observation and operator context in both a specimen lifecycle event and audit event.
- `QUARANTINED` is a first-class database and Prisma enum state, with a preserving enum migration, Arabic status label and bilingual scanner warning. Re-reception, aliquoting, tracked-volume consumption and manifest dispatch remain blocked by the existing lifecycle status checks; rejection/recollection is permitted through the existing audited workflow.
- The result release transaction locks the linked specimen records and refuses release if any associated source specimen is quarantined. This is a conservative safety rule; it cannot retroactively recall a previously released result.
- **No quarantine-clearance/override permission is implied or implemented.** Any future release of quarantined material requires a clinically approved policy and independent authorization workflow. Until then the safe path is documented rejection/recollection.
- MariaDB integration now verifies quarantine is an allowed persisted state and still counts as physical storage occupancy; the fixture rolls the simulated transition back to preserve subsequent tests.
- Manual device/UAT remain deferred until whole-project testing, without claiming they passed.

## Direct in-transit reception bypass closed

- Specimen `RECEIVE` action now permits `COLLECTED` only. In-transit material must be received through the audited manifest `RECEIVE_ITEM` route; source-branch operators cannot bypass the transfer chain of custody with the generic reception endpoint. The scanner UI follows the same lifecycle rule.
- Source and clinical lifecycle regressions cover `IN_TRANSIT` rejection from direct RECEIVE, and the explicit `QUARANTINED` state permits only controlled rejection/recollection without an unauthorized waiver.


## Audited inter-branch receiving discrepancies and missing specimens

- Destination operators can now report a manifest barcode as `MISSING`, `DAMAGED`, `LABEL_MISMATCH`, `TEMPERATURE_FAILURE`, or `OTHER` with mandatory details through `REPORT_EXCEPTION`. Both the item status (`EXCEPTION`) and its reason snapshot are durable, and a specimen event plus audit record identify actor, manifest, barcode and custody.
- `MISSING` is **not** a receipt: the specimen remains `IN_TRANSIT` with no implied destination physical custody. Other discrepancies confirm arrival at the destination but put the specimen into `QUARANTINED`; analytical use and result release remain blocked.
- Exceptions do not silently mark the manifest `RECEIVED`: it remains `PARTIALLY_RECEIVED` and requires reconciliation. The current fail-closed workflow does not allow a later unreviewed scan to clear the exception, and no clinically unapproved exception waiver is fabricated.
- Added bilingual UI exception fields and safe server-side tests. Deferred full-project UAT and a future explicitly authorized exception reconciliation procedure must be recognized separately from code delivery.
