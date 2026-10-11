# Stage 74 — Immutable Patient / Order Attestation for Cumulative Diagnostic Report Comparisons

## Baseline and verified gap
- Started after owner-confirmed Stage 73 Hostinger deployment at `7238aa2dd0a3f919f4f9fb65d6994a21a680e92f`, with merged-`main` CI #1038 SUCCESS.
- Master Scope §§4, 40, 42–44 demand auditable, immutable result/report versions and safe comparative displays across merged patient aliases.
- Staff-side `src/lib/report-cumulative.ts` previously accepted current report content purely by matching an `orderItemId/resultId/resultVersion` pointer. It did **not** validate that the immutable `contentSnapshot.order.id`, accession number or `contentSnapshot.patient.id` matched the independently loaded database order/patient. Corrupt/misplaced report evidence could therefore be presented in another patient's comparison.
- A conflicting duplicate pointer (same `resultId`, two item/version tuples), duplicated frozen result rows, or repeated component code could also be interpreted as comparable evidence.

## Changes
1. `ReportComparisonEvidence.order` now requires the original `patientId` from the actual order. Both current and prior report queries explicitly select it; no current patient master demographic values are substituted for the frozen patient ID.
2. `extractCurrentReportReadings` requires the immutable current report content's order ID, accession, and historical patient ID to match the DB order, including original merged-alias order identities. Missing/mismatched evidence fails closed.
3. Reuse Stage 71's exact current result pointer resolver (conflicting IDs excluded) and require exact `resultId`, `orderItemId`, `resultVersion` and issuing `orderId`. Duplicated content result IDs or component codes are excluded. The procedure does not reconstruct or repair old report data.
4. Keep the authorized performing-branch filter and originating order-branch/tenant discovery, the Stage 73 transitive patient group, 100-prior-order inspection limit and disclaimer, the unit/method/analyzer comparability policy, and existing no-print separation of the comparison panel from signed reports and PDFs.

## Automated verification
- Update Stage 20 unit and MariaDB report fixtures to include the order and patient provenance that actual released report snapshots already contain.
- `tests/stage-74-report-cumulative-identity-integrity.test.ts`: correct order, wrong order/accession/patient, old merged-alias identity, corrupted/duplicate pointers and values, restricted performing branch, and no-print invariants.
- `tests/stage-74-report-cumulative-identity-mariadb.integration.test.ts`: actual MariaDB isolated organizations, patients, ordering/performed branches and immutable issued report/version JSON; synthetic wrong-patient and wrong-order snapshots are inserted as malformed data, not produced by a clinical release action. Valid historical result selection and reference range preservation are checked.
- `.github/workflows/ci.yml` invokes the Stage 74 MariaDB integration; existing full migrations, test:safety, remaining MariaDB stages, TypeScript, lint, bilingual UI and production build remain required.

## Safety / deployment
- Read-only report comparison change; no migration, release/amendment, price, payment, authorization, template or patient data mutation. A corrupted report version is withheld from the comparison only; the underlying immutable issued report record is never altered or deleted.
- Missing/invalid snapshot identity is **not** treated as absence of past tests. Clinical data-integrity investigation may be required.
- The 100-record previous-order comparison window and patient history 20-report page are still explicitly bounded. No claim of complete longitudinal trend from one page.
- Real clinical/device/manual UAT and financial/clinical signatories remain deferred, **not passed or authorized**.
- PR #128 Analyzer Bridge must remain OPEN/DRAFT and untouched.
