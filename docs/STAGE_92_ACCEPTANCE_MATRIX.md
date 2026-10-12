# Stage 92 — Reviewed Bilingual Report-Level Clinical Interpretation

## Current-main gap and boundary
Base main: `84ef506554315ba5e6accc1093c9c577cd7cc62d` (owner-confirmed Hostinger release, main CI #1118 SUCCESS).
Master Scope §§37–43, 73, 80 require report-level text that can be independently reviewed and historically preserved. Existing reusable clinical comment template governance (Stages 84–87) applies to *templates*, not patient/order-specific report-level text. Stages 90 (EQA and Home Collection) and 91 (doctor patient disclosure) remain untouched.

Prior unfinished Draft PR #209 was inspected for relevant implementation patterns. The Stage 92 work is newly based on the current main, with a fresh migration, reviewed code, and an explicit report-release/approval serialization fix. PR #209 remains unmerged; PR #128 Analyzer Bridge remains untouched.

## Functional workflow
1. A staff member with `reports.view` plus `results.medical_validate` opens an order's report interpretation page and drafts exact English/Arabic clinical text. Authoring requires live tenant, ordering branch and department permission, a valid active branch scope and a non-cancelled order item.
2. Immutable `report_interpretive_comments` revisions track author, tenant/order, sequential revision, predecessor and text in both languages. Only one outstanding draft per order is permitted. Unique per-order revision numbers and serialized order row locking prevent racing authors.
3. A *different* clinician with `reports.view` plus `results.release` reviews an unchanged SHA-256 fingerprint containing both language texts, author, revision, status, creation time and predecessor. Approval requires an explicit whole-text confirmation and 10–1000-character reason. Rejection also requires a reason. Concurrent or stale approvals fail closed.
4. On approval, the previously approved interpretation is retired atomically; all revisions and audit evidence remain. Rejection leaves the previous approved interpretation in place.
5. Results release reads only the approved interpretation, if any, under a transaction row lock shared with interpretation review and copies it into the **new** `DiagnosticReportVersion.contentSnapshot`. Existing report version JSON, token, content and historical clinical results remain unchanged; approval alone **does not** trigger report release or an amendment.
6. Staff report display reads only the frozen report snapshot, not the current interpretation row. Bilingual text respects report language and RTL/LTR; historical versions without this field remain valid.
7. Order details and report pages link to the protected bilingual review screen. Non-authorized staff cannot author or approve, and department/branch scopes are server-enforced.

## Database & security
- Additive migration: `20261012180000_report_interpretation_governance` (new table and foreign keys only). No existing patient, clinical, billing or report data is updated.
- Keys: organization, order, created-by, reviewed-by and self-referencing predecessor; per-order unique revision. No separate test table, no copied legacy Access schema.
- Workflow writes and audit are transactional at Serializable isolation. Release serializes on the order *before* building the frozen interpretation snapshot, alongside existing report-version lock.
- English and Arabic texts are required and retained in full. No generated clinical interpretations, clinical medical claims, invented thresholds or automatic release.
- Existing report templates and earlier comment revisions are unchanged.

## Automated acceptance
- Node safety tests: input validation, bilingual fingerprint drift, independent reviewer, status/predecessor revision, reason and explicit approval confirmation, protected snapshot and source controls.
- MariaDB two-connection integration: tenant boundary, exact FK/unique integrity, simultaneous transaction lock contention, approval evidence, old/new report version immutability and retained audit trail.
- CI: Prisma migrate/status/generate, full Node safety tests, Stage 92 MariaDB integration plus existing MariaDB suites, TypeScript, ESLint, RTL/LTR/i18n and production build on exact feature SHA; independent main CI on exact merged SHA mandatory.

## Deployment & deferred acceptance
- **Backup the Hostinger database before updating**, as the existing `npm run build` includes `prisma migrate deploy`; do not use `db push`.
- New additive migration required; no new environment variables.
- Owner verifies Hostinger deployment after merge and independent main CI.
- Final clinical signatory/governance, live staff workflows, printable/PDF layout, device/scan/analyzer and qualified end-to-end UAT remain deferred until full product implementation, not marked passed.
- Master Scope still includes dedicated order-level interpretive annotations and clinician electronic ordering; these are not claimed complete by Stage 92.
