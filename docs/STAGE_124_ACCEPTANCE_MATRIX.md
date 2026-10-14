# Stage 124 — Exact Historical Analyte Identity and Analytical Comparability for Delta Checks

## Grounded gap
- Deployed baseline: Stage 123 `c1ad68bc1363b566ca1ce06387ed90f632af672d` on `main`, independently successful CI #1270 with 134 steps. Owner confirmed Hostinger publication.
- Master scope: historical clinical integrity, single-test and panel analytes, Delta result validation, multi-branch results, methods and units (§§7–11, 20–24, 38–41, 75, 79–80).
- Existing `evaluateDelta` chose previous result for `componentId=null` using `componentCodeSnapshot:{not:""}`. A prior numeric observation of a different field under the same test could be treated as the current analyte. Its historical lookup did not constrain the previous result method or frozen value unit. Thus a newer incompatible reading could produce false `WITHIN_LIMIT` or `EXCEEDED` decisions and influence downstream review.
- Both manual result entry and analyzer import call `evaluateDelta` (including calculated results) and persist its historical comparison evidence in immutable released value snapshots.

## Delivered
1. Central typed `deltaHistoricalValueWhere` query builder uses **organization, patient, test, released prior result, and exact analyte identity**. If a component UUID is present, use the stable `componentId`; if null, require matching `componentId=null` AND exact snapshotted `componentCodeSnapshot`, not just any nonempty code.
2. Require exact prior result `methodId`, current `unitId`, and historical `unitSnapshot`, including explicit null/null compatibility, without inferred unit conversion or silent use of current mutable catalog metadata. Match numeric result type and nonnull numeric value, keeping original lookback/released-status rules and the existing Decimal arithmetic.
3. All four real callsites (manual direct, manual calculated, analyzer direct, analyzer calculated) pass configured component code, unit ID and frozen unit symbol; existing method ID already passed and is now enforced for prior observations.
4. If there is no safe comparable prior observation, use existing `NO_PREVIOUS_RESULT` state, with no false prior numeric value or fabricated delta breach. Active rules and limits remain recorded; no automatic approval/release.
5. Safety regression checks query predicates and callsite wiring. Real MariaDB integration test inserts synthetic released values for the same patient and test with mismatched code, method, unit ID and frozen unit text, verifies selection of only the comparable reading, and checks that amendment of the sole valid historical reading leaves `NO_PREVIOUS_RESULT` despite other incompatible values.
6. No Prisma migrations, no update to old results, rule values, report versions, patient identity or billing snapshots. Existing Stage 120–123 clinical sign-off controls preserved. Draft PRs #128/#209 untouched. Hostinger only.

## Clinical acceptance boundaries
- Selecting a compatible prior reading is **not** proof that comparison is clinically meaningful across different analyzers/branches; exact method and frozen unit are a conservative first safety gate, and specialist policies must still validate analytical comparability.
- Historic report snapshots must not be silently recomputed. This behavior applies only to newly entered results, not retrospective amendments of past released values.
- No UAT, medical device checks, analyzer-instrument testing, and physical clinical sign-off until final integrated development gate as agreed.

## Gates
- [ ] Exact feature HEAD CI Safety, MariaDB, TypeScript, ESLint, Arabic/English and Next production build SUCCESS.
- [ ] Draft PR Ready → expected_head_sha merge.
- [ ] Independent main CI SUCCESS for exact merged SHA.
- [ ] Owner publishes SHA to Hostinger.
