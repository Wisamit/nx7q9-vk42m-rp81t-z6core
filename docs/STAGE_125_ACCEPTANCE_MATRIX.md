# Stage 125 — Delta Comparable Baseline Gate for Autoverification

## Verified baseline and clinical risk
- Baseline: owner-confirmed Hostinger Stage 124 merge `41bc09dfa22d93ecc993e9d302eb08e6b305ed2d`, independent main CI #1275 SUCCESS.
- Master scope §§10, 38–41, 63–64, 75, 79–80; no scope removal.
- Stage 124 already made historical Delta comparisons analyte-, method- and unit-safe and returns `NO_PREVIOUS_RESULT` when prior history cannot be compared reliably. It never creates imaginary historical values.
- **Gap:** `src/lib/autoverification.ts` blocked only `EXCEEDED` Delta but treated `NO_PREVIOUS_RESULT` as satisfactory, even for policies explicitly configured with `requireDeltaWithinLimit=true`. This could allow an analyzer result with `PASS` QC and otherwise normal values to pass automatic technical review without a trustworthy Delta comparison.

## Implementation delivered
1. If an enabled autoverification policy sets `requireDeltaWithinLimit=true`, *any* result value having `deltaEvaluation=NO_PREVIOUS_RESULT` adds `DELTA_COMPARABLE_BASELINE_REQUIRED` and **fails automatic technical review**. Existing manual technical review and clinician approval remain available; no result auto-release is introduced.
2. `EXCEEDED` remains blocked regardless of that flag; this stage **does not** loosen critical, pending Reflex, validation hold, abnormality or analyzer QC blocks.
3. `NOT_CONFIGURED` remains distinct from `NO_PREVIOUS_RESULT`: absence of a configured Delta rule is not falsely labeled as missing prior history; clinical rule coverage remains a separate configuration decision.
4. Result entry and analyzer import share the same `evaluateAutoverification` library. Both already retain an immutable autoverification decision snapshot and use `automatedTechnicalReviewOutcome`; no duplicate UI/backend rule is introduced.
5. `tests/stage-125-delta-autoverification-safety.test.ts`: policies, mixed analytes, first-time unmatched baseline, normal/comparable, no configured Delta, exceeded, QC, critical, pending Reflex and hold regression; validates that automated technical review stays in `TECHNICAL_REVIEW` rather than `VERIFIED` when history cannot be compared.
6. `tests/stage-125-delta-autoverification-mariadb.integration.test.ts`: a synthetic active Delta rule and active autoverification policy in real MariaDB; initially there is only a **wrong-method** released prior observation. `evaluateDelta` returns `NO_PREVIOUS_RESULT` and blocks autoverification with a clear reason. A second MariaDB connection inserts (without modifying existing released history) a legitimate comparable prior observation; the same policy then permits a normal `WITHIN_LIMIT` technical outcome. CI invokes the integration test.
7. No Prisma migration, new clinical thresholds, automatic approval, patient history rewrite, tariff change, staff grant change or analyzer protocol modification.

## Clinical acceptance boundary
- This change intentionally requires **human review when configured Delta comparison lacks trustworthy history**; the missing prior is not treated as proof of a safe current value.
- It does not decide that a new patient's first-ever result is clinically abnormal, nor does it block manual authorized validation. A qualified lab team sets effective Delta and autoverification policies.
- Cross-analyzer comparability, instrument QC in the field, medical UAT, barcode flows and physical print/backup tests remain deferred to the final integrated testing gate as agreed.
- Existing Analyzer Bridge Draft PR #128 and interpretation Draft PR #209 remain untouched. Hostinger is the deployment target, never Vercel.

## Release gates
- [ ] Feature HEAD CI: Safety, real MariaDB, TypeScript, ESLint, AR/EN and Next build SUCCESS
- [ ] Draft PR review and merge with exact expected HEAD SHA
- [ ] Independent main CI success at merge SHA
- [ ] Owner confirms Hostinger deployment of released SHA
