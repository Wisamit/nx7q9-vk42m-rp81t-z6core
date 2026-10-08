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
