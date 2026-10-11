# Stage 72 — Published Clinical Value Provenance for Longitudinal History

## Verified baseline and scope
- Started from Stage 71 merged `main` SHA `766b8d31d762f3fb8b021c9f62a4d6a7321e4fd3`, main CI #1030 SUCCESS.
- Master Scope §§4, 40, 42, 44, 79 and 80 require current released report evidence, truthful longitudinal values, historical reference/unit integrity and scoped authorization.
- Stage 71 already checks exact order, order item, result ID and result version pointers. It did **not** check that live `laboratory_result_values` displayed in the patient history still agree with the immutable `diagnostic_report_versions.content_snapshot`. A bad row update, accidental drift or mismatched snapshot could otherwise show a different result, unit, critical flag or reference interval in the cumulative history/trend even when its result pointer remained valid.

## Implementation
- Added `src/lib/patient-history-published.ts` to locate the **current** `PARTIAL` / `FINAL` / `AMENDED` report snapshot and require its immutable embedded `order.id` to match the actual report order.
- For each observation, require exact Stage 71 pointer and matching `resultId`, `orderItemId`, revision, test ID, performed branch, method, analyzer code and every report-visible component's code, identity, published name, display value, unit, result flag, critical flag, reference interval and localized reference text.
- Reject missing, duplicate, malformed or conflicting published observations instead of inferring/rebuilding historical values. A drifted observation is suppressed from both cumulative table and trend; it is not rewritten.
- Numeric trend values now come only from the **printed numeric display value** when the observation was numeric, not an unprinted internal high-precision value. Qualified or formatted nonnumeric displays are omitted from the chart. No clinical conversions or reference reinterpretation.
- The existing patient history permissions, organization/patient/merged-alias/branch/department restrictions, version pagination and Stage 71 exact-pointer gate remain in place. Result trends are still explicitly limited to the selected page of up to 20 report records, rather than misrepresented as complete history.

## Verification
- `tests/stage-72-patient-history-published-integrity.test.ts` covers matching and drifted/ambiguous/retracted frozen evidence, provenance, numeric chart gate and page wiring.
- `tests/stage-72-patient-history-published-mariadb.integration.test.ts` uses actual MariaDB tenants, branches, patient, order, result/value and report version; tests authorized released publication, cross-tenant/branch exclusion, value and range drift fail-closed, and retraction.
- Added the real MariaDB integration run to `.github/workflows/ci.yml`, alongside existing migrations, safety suites, TypeScript, lint, i18n, UI theme and Next build.

## Limits / clinical safety
- Read-only application logic. **No Prisma migration**, no release/amendment workflow change, no price/financial state change, no signing-policy activation and no Hostinger environment variable change.
- Conflicting/malformed evidence is hidden pending clinical/data-integrity investigation. Automatic repair and false certainty are prohibited. Existing report PDFs and immutable issued versions are unaffected.
- The 20-report/page patient trend limitation remains a separate full-scope gap. Real clinical signatory approvals, medical UAT, instrument/device validation and final acceptance remain deferred by owner agreement (not waived).
- PR #128 Analyzer Bridge remains OPEN/DRAFT, entirely separate.
