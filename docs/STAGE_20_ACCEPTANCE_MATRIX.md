# Stage 20 — Cumulative Comparison in Diagnostic Report Detail

**Base:** `4d5bb0137e905136f579b04ef4a2a5507600e32e` (Stage 19 / `main` CI #872 success, Hostinger deployment explicitly confirmed by owner).

## Audit and delivery — Master Scope §44

Existing patient-longitudinal page already offers cumulative result rows and graph trends, but the staff diagnostic-report detail route did not display **previous comparable readings beside the current release**. Stage 20 fills that specific gap through a staff-only bilingual comparison table, **outside** `#diagnostic-report-version`, and with `no-print` styling. It does **not** mutate the released report content, template, PDF, verification token, delivery semantics or clinical reference snapshots.

### Patient and clinical safety

- Requires staff `reports.view` and existing current order branch authorization. No new patient/portal/doctor/corporate access is granted. For staff with explicit department scopes, the comparison is **disabled**, conservatively, until source-snapshot-based historical department policy is implemented.
- Considers the central patient identity and direct merged historical aliases from the same organization. Historical reports must have an allowed ordering branch and contained results must have an allowed performing branch. Foreign organization records, restricted branches and withdrawn report versions do not contribute historical values.
- Each reading must be present in the **current, non-retracted** prior diagnostic report version's immutable result snapshot, with an exact result pointer (`resultId`, `orderItemId`, `resultVersion`) in `resultVersionSnapshot`. Superseded and malformed release evidence is excluded.
- Matches by stable test ID, component ID, **exact unit, method ID and analyzer code**. Missing test/component/method evidence fails closed with a clearly labeled unavailable reason. No implicit conversion, mixing of methods/devices, re-flagging, reference interval recalculation or clinical diagnosis.
- Displays old issued date, accession, value, flag and **historical reference interval from the immutable prior report snapshot**. Does not produce a patient trend interpretation.
- Scans only the **100 most recent previous authorized report orders**, with a 101st record as overflow sentinel. Explicitly warns if older report orders exist; absence of a comparison means *none in the inspected accessible window*, not *never tested*.
- Suspends current comparisons when the current report is retracted; shows a withdrawal warning separate from the immutable record.

### Coverage

- `tests/stage-20-report-cumulative.test.ts`: snapshot pointer integrity; comparable vs method/unit/analyzer/test/component mismatches; cross-branch restrictions; retracted/malformed/future reports; route-authorization and no-print guards.
- `tests/stage-20-report-cumulative-mariadb.integration.test.ts`: two real MariaDB connections, two organizations, allowed and unauthorized branches, current report and two older reports, committed retraction visibility and correct comparison fallback.
- `.github/workflows/ci.yml` runs the new real MariaDB test alongside all existing MariaDB/integrity tests, `npm run test:safety`, Prisma migration/generate/status, TypeScript, lint, bilingual theme/i18n and Next.js build.

## Master Scope still open

- Staff patient history lists and cumulative results remain unpaginated; implement bounded, scope-correct patient-history discovery without silently truncating clinical or financial totals.
- A more extensive report trend/cumulative view and full export may be added only with clinical release and disclosure policy. This Stage 20 table selects **one most recent comparable prior result** per current component and does not claim a full historical series.
- Analyzer Bridge PR #128 stays **Draft, OPEN, UNMERGED** and must be reconciled independently against the latest `main`.
- Full Master Scope §§1–88 remains required, including specialized results, catalog import/export and legacy migration completion, clinical rule coverage, governed financial policies, and real backup/provider/device readiness.

## Acceptance

Automated CI gates must pass on exact feature SHA and again on resulting merged `main` SHA. Hostinger deployment success is **owner-confirmed only**, never inferred from CI. Manual interface, device, clinical, provider, finance and full-system UAT remain **DEFERRED until the full product is built**, per owner instruction.
