# Stage 119 — Scoped Legacy Specialty Evidence Review and Non-Clinical Coverage

## Verified baseline and concrete gap
- Base latest `main` `27436acd2d17bc1070b8dd1892024e7b7777d54e` (Stage 118 PR #242 merged, independent main CI #1255 SUCCESS, owner-confirmed Hostinger publish).
- Master Scope §34 Specialized Result UIs / §11 Reference Ranges / §88 Legacy Access Migration / §2 Multi-branch / §63 Permissions / §80 Clinical history.
- Stage 103 already delivers a configuration-driven specialty result workspace/layout preview and atomic apply for all active components; **do not reimplement it or copy per-test result tables from Access**.
- Stage 105 already validates and reviews read-only specialty reference-range source JSON, but its review route compared **every legacy specialty source table** with the currently selected LIS test, even when unrelated (e.g. CBC data against a thyroid test), creating misleading unmatched component counts.
- The Stage 105 endpoint validated organization and active branch session but **did not check whether the selected lab test belonged to an authorized branch/department** nor recheck revoked grants inside a consistent read.
- Stage 118 added raw MDB inventory counts, not clinical source-table selection or clinical component mapping sign-off.

## Delivered
1. Explicit single source table selection among 10 **known legacy range table identifiers**. Missing or unsupported selection fails closed; no automatic inference that a specialty name or file implies a test link.
2. `buildSelectedSpecialtyEvidenceReview` compares only the selected source table with active configured components; reports exact-code pair matches, source pairs unmatched, duplicated/ambiguous component codes, components not represented by **paired low/high source columns**, malformed/incomplete range evidence and other excluded table count. Labels never equate missing low/high columns with absent clinical tests (qualitative/text assays may be legitimate).
3. API `POST /api/catalog/legacy-specialty-evidence` reuses strict Stage 105 evidence parser and source limit. Checks active session's authorized branch/department using `resolveClinicalImportScope`, then revalidates active org, live catalog permission, current branch membership and current department scopes **inside a RepeatableRead transaction** before reading test components through `clinicalImportTestWhere`. Revoked permissions, changed clinical scope, off-branch/off-department/inactive or foreign-tenant tests fail closed.
4. Bilingual Arabic/English source-table picker and explanation integrated into existing `LegacySpecialtyEvidenceReview` on test details. No new hard-coded clinical thresholds, unit/range assignment, report interpretation or medical content.
5. Explicit review-only API: no low/high observation values in response, persistence, clinical interval activation, result update, report version edit, instrument import, price edit, or clinical approval. Uploaded source SHA is informational, not independently verified.
6. Regression: `tests/stage-119-specialty-scope-safety.test.ts` (part of full safety suite), `tests/stage-119-specialty-scope-mariadb.integration.test.ts` (real MariaDB scoped test/component filtering and no reference writes), CI wired for MariaDB. Retains Stage 105 review helper for existing consumers and tests.

## Limitations / next targeted steps
- This **does not complete** all specialty workspaces or prove every source table is mapped to an authorized clinical test. Exact field/code matches are *hints*, not interpretation approvals. No template is automatically created.
- Full clinical configuration, unit, method, specimen applicability, age, sex, source row evidence, actual range approvals and device/printing UAT remain **deferred until final development gate** and must not be declared PASS.
- Source review is read-only and not a patient history or result-value migration. Stage 118 does not prove MDB row-level parity.
- Legacy Access source tables named `cbc` or `Urine` for results are different from allowed `cbcn` etc reference range evidence. This stage does not extract patient-level historical data.
- No Prisma migration or data modification. Existing Draft PR #128 and #209 untouched; Vercel not used.

## Required release gates
- [ ] exact feature HEAD Safety + MariaDB + TS + ESLint + UI/i18n + Next build CI SUCCESS
- [ ] Draft PR ready → expected_head_sha merge
- [ ] independent main CI success on merge SHA
- [ ] owner deploys SHA to Hostinger
