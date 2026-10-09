# Stage 19 — Longitudinal Clinical History and Current-Report Integrity

**Base main:** `5a217ed2c017713497a8835b0e45d404a1a9f149` (Stage 18, CI #870 SUCCESS, owner-confirmed Hostinger deployment).

## Master Scope audit (§4 and §44)

| Requirement | State at beginning | This increment |
| --- | --- | --- |
| Central patient identity and merged aliases | Implemented in Stage 5 | Reuse; unchanged |
| Authorized order/test and billing history across branches | Implemented, branch/permission scoped | Reuse; unchanged |
| Result trends and cumulative readings | Implemented | Harden report-release evidence and method/analyzer comparability |
| Historical amendments, retractions and report versions | Report version history exists | Only **current** non-retracted report pointers can contribute active longitudinal readings |
| Financial payment/invoice and attachment history | Implemented with separate permission gates | Patient-level attachment list now also requires allowed branch |
| Selected prior analytes beside a currently viewed diagnostic report | Not implemented on report detail | Remains open (§44); do not mislabel as done |
| Pagination/explicit time windows for large history | Not bounded on patient history | Remains open for future scale increment |
| Current, reliable clinical method/source identities for trending | Method/analyzer provenance exists | Separate series; unknown-method readings are individual, not comparable |
| Portal-specific longitudinal grants | Different from staff history | Not expanded; existing portal grants retained |

## Clinical visibility policy

1. Preserve released result and report revisions immutably. No schema migration or historical backfill in this increment.
2. Query *current* report version evidence for the organization and merged patient identities. `PARTIAL`, `FINAL` and `AMENDED` versions may contribute only their explicitly referenced result IDs. A `RETRACTED` current version, missing current version or malformed revision pointer contributes none.
3. Result rows are still queried with organization, actual performing branch, department scope and released/amended status. An amendment from another performing branch cannot reveal a superseded result through an old branch scope.
4. Never plot mixed units, catalog components, methods or analyzer identities. Missing method evidence prevents longitudinal point-to-point trend comparison. No unit conversion, medical interpretation or automatic threshold inference is introduced.
5. Continue showing report version chronology and status labels separately from *current* clinical values. Older versions are not silently presented as current. Patient attachments must pass branch and organization scope.
6. Reuse English/Arabic UI with RTL/LTR support.

## Automated engineering gates

- `tests/patient-history.test.ts`: current/retracted/malformed report evidence; method and analyzer split; attachment branch boundary and source-level regression.
- `tests/stage-19-longitudinal-mariadb.integration.test.ts`: two real MariaDB connections, two organizations, multiple branches, current amended result, superseded result hidden, retraction hidden, foreign tenant hidden and post-commit retraction visibility.
- CI runs migrations, Prisma generate, safety tests, Stage 19 MariaDB integration, all previous MariaDB suites, TypeScript, ESLint, bilingual UI checks and Next.js build.

## Deliberate boundaries

- Does not automatically grant cross-branch patient/report access. Existing ordering/performed branch and department grants remain binding.
- Retraction/history and unusual medical workflows require final clinical verification before operational go-live.
- Large patient histories still lack pagination/windowing and the diagnostic report page does not yet embed a configurable current-versus-previous comparison.
- The unrelated Analyzer Bridge **PR #128 remains open, draft and unmerged**. No device connectivity acceptance is inferred here.
- Full Master Scope §§1–88 remains required. No feature removed.

## Status

Engineering CI and merge gates are to be recorded from GitHub for the exact final feature/main SHA; no Hostinger deployment inferred from CI. **Manual UI, physical devices, clinical/go-live UAT and provider validation are DEFERRED** by owner instruction until the entire system is implemented, not passed or waived.
