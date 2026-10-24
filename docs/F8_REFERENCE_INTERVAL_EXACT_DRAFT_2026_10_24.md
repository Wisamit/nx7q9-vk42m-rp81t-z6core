# F8 §75/87 — Exact reference interval DRAFT admission and branch scope

Baseline: `main=2d455aff2af946ee159cb2d2ab878bf4cc70dee3`, independent push CI #40065301226 **COMPLETED SUCCESS**. Original 88-section `02_MASTER_SCOPE.md` scope remains unchanged.

## Proven code-level safety bug

`POST /api/catalog/reference-intervals` previously admitted financial/clinical JSON numbers through `String(value)`, then compared reference/critical boundaries with `Number(value)`. Database columns store `DECIMAL(18,6)`: legal 12-digit integer values with six fractional digits can collapse to the same IEEE-754 number. An inverted critical or normal bound separated by 0.000001 could be accepted as apparently equal; SQL type limits, exact age/gestational scale and negative age admission were not checked. The same endpoint truncated provided 36-character branch/method/analyzer/specimen identifiers, making an invalid supplied branch ID look like no branch (organization default), and silently truncated the population code and PATCH audit reason.

## Engineering remediation

- Use the project's existing `parseClinicalRuleDecimal` for every clinical limit, scale and sign: age `DECIMAL(10,3)`, gestational weeks `DECIMAL(6,2)`, and low/high/critical `DECIMAL(18,6)`. Accept **only original decimal strings**; no JavaScript number/coercion, rounding or database truncation.
- Compare normalized exact fixed-scale integer digits with `BigInt`, not `Number`: inverted bounds at the high end of `DECIMAL(18,6)` now fail closed.
- For supplied clinical effective dates, accept only exact `YYYY-MM-DD` or explicit full UTC ISO timestamp and reject impossible calendar rollover, local-time ambiguity or UTC offsets without an approved branch-timezone conversion. Existing absent-date default remains current time.
- Reject invalid/overlong clinical context UUIDs, inaccessible requested branch, unsupported sex code, invalid or overlong population code and overlong bilingual normal text/source. PATCH approval/retirement refuses overlong reason rather than hiding discarded source evidence.
- All creates still `approvalStatus=DRAFT`, `status=INACTIVE`, audited transaction. NO automatic clinical approval, cutoff choice, age-unit conversion, method guess, branch grant elevation, historic report update or analyzer release.
- Pure adversarial tests cover IEEE-754 collapse of values at 999999999999.xxxxxx, negative clinical limits, exact maximum bounds, excessive precision/scale, JSON numbers, impossible UTC dates, branch authority and no source clipping. A real MariaDB integration test verifies all eight persisted column DECIMAL definitions and exact database string round-trip.

## Completion gates and user action

§75 clinical/vendor interpretation, analyzer sample interference, age/sex/gestational policies and qualified medical signoff remain `BLOCKED_EXTERNAL`. §87 full field-level governed activation remains `PARTIAL`; existing independent clinical/finance F2 approval/application path is preserved. §§86/88 qualified financial tax/source MDB parity evidence remain blocked externally.

F7 protected private browser 0/486 NOT_EXECUTED; F8 qualified real-world UAT 0/88, seven independent signatures missing: `NO_GO`. Public CI does not establish field clinical GO, Hostinger deployment, device commissioning, or DR restoration. No manual owner/hardware testing requested during coding.

Merge gate: complete feature CI on exact HEAD, expected-head-only merge, new independent `main` push CI success on exact merge SHA.
