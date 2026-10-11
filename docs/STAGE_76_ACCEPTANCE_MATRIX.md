# Stage 76 — Frozen Patient/Organization/Order Identity Integrity in Staff History

## Verified baseline and clinical gap
- Baseline: owner-confirmed Hostinger Stage 75 deployment from `main` `ecfdb0faf3a1868d0146e53e4895c1fcedd0bba3`, independently green CI #1047.
- The staff history used immutable result pointers (Stage 71), exact published observation values (Stage 72) and an authorized, separately bounded 250-report chart window (Stage 75). However, `publishedHistoryEvidence` checked only `contentSnapshot.order.id` against the report order ID. It did **not** check the frozen tenant, original patient ID, accession or ordering branch against independent order metadata.
- A malformed or wrongly attributed signed JSON snapshot could be disclosed on a patient history / cumulative results chart even if its contained result item IDs and numerical values still matched. Master Scope requires central but immutable patient identity, original branch custody and truthful historical report evidence.

## Changes
- The report-evidence Prisma query now selects `organizationId` and original `order.patientId`, `order.accessionNumber`, `order.orderingBranchId` (alongside order ID and current version) for every authorized page or 250-report scan.
- `publishedHistoryEvidence` checks the **four immutable source dimensions**: organization ID, original patient ID, accession and ordering branch ID, plus the existing order ID and exact current report revision/result pointers and released-value provenance. All snapshot structures must be present; no missing identity is inferred.
- Live candidate order identity is checked again against that fully attested issued evidence, including tenant, historic patient ID, accession, and order branch, in addition to performing branch/method/analyzer, test ID, component/value/flag/reference limits.
- Legitimate merged aliases retain the **original patient ID recorded on each order**, not today's canonical patient; normal merged-patient lineage resolves which original order patient IDs may be requested.
- Any mismatch is quarantined from the displayed clinical table **and** expanded trend graph, with no silent repair or destructive change to signed report history.
- Existing authorized tenant/department/branch gates and current report/retraction checks remain unchanged. Result pages are still 20-report windows and chart expansion is opt-in up to 250 with overflow disclosure.

## Verification
- `tests/stage-76-patient-history-identity-attestation.test.ts`: authentic original alias, 13 frozen identity mismatch/missing conditions, live-order divergence, separate ordering/performed branches, source/permission wiring and builder snapshot shape.
- `tests/stage-76-patient-history-snapshot-identity-mariadb.integration.test.ts`: two independent real MariaDB connections with two organizations, three branches, canonical/merged alias and unrelated patients, legitimate cross-branch order/performance, and distinct **immutable inserted** valid/malformed signed report fixtures. Validate cross-tenant, wrong patient, accession, branch, tenant and retraction suppression.
- Update Stage 72/75 unit and MariaDB fixtures to reflect the actual `report-snapshot.ts` issued format, which includes organization, order, branch and patient provenance.
- Stage 76 MariaDB suite becomes an explicit CI gate alongside full migrations, existing clinical/finance and MariaDB suites, TypeScript, lint, bilingual UI checks and Next production build.

## Boundaries and remaining work
- Read-only safety hardening. **No migration**, new Hostinger environment variables, released clinical history overwrite, price/tax/payment mutation, new authorization grants, or activation of medical/financial policies.
- Reports with missing/corrupt frozen evidence are withheld from current history/trends and may need **separate authorized clinical data-integrity investigation**. This does not assert that patient never underwent testing.
- Manual clinical/device/financial/prod UAT remains DEFERRED until final overall product acceptance and is not silently declared passed.
- PR #128 Analyzer Bridge must remain OPEN/DRAFT and unmerged.
