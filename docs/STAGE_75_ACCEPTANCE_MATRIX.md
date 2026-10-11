# Stage 75 — Authorized Cross-Page Longitudinal Clinical Trend Exploration

## Baseline, audited discrepancy and scope
- Start SHA: `88a314f105fdde242d886b4a9cf3131cfc35f4cb` (Stage 74 merged main CI #1040 SUCCESS; Hostinger deployment explicitly confirmed by owner).
- Master Scope §4 requires patient trends for repeat analytes across orders and branches, respecting §2 organization/branch access and immutable report evidence §§40–44.
- Pre-Stage 75 trend charts were restricted to the **same 20 diagnostic reports as each results history page**. Page navigation isolated older results on separate screens: a chart on page 1 could not show earlier published numeric measurements from page 2 even for the same analyte.

## What changed
- Add explicit, staff-only **Explore up to 250 reports in trends** link under the authorized results section. Not a default query, and unavailable on other sections, subsequent pages or without `reports.view`.
- The wider report search is `skip: 0`, `take: 251` and retains the same tenant, merged central patient identity, current report revision, ordering/performed branch and department gates as the original results page. The 251st record is **sentinel only**, not clinical chart evidence.
- A shared typed `clinicalTrendWindow` partitions **page table results (20 reports)** and **charted evidence (up to 250 reports)** without mixing snapshots. The existing result table and its own pagination remain bounded to 20; the expanded option does not make the cumulative table accidentally unbounded.
- Both page-only and expanded chart candidates pass Stage 71 exact order/order-item/result revision pointers, Stage 72 **every published component value/reference/unit/method/analyzer** matching immutable report content, live branch/department/result status filters, and latest revision selection.
- Existing unit/method/analyzer grouping, unknown-method no-comparison policy and published numeric-only charting remain unchanged.
- UI explicitly discloses **the report count and 250-record limit**. On 251+ records it **warns that older reports exist beyond this window**, avoiding false claims that a graph covers a patient's complete life history. When no overflow, it still discloses that only current issued, verified numeric results appear.

## Automated tests
- `tests/stage-75-extended-patient-trends.test.ts`: authorization, page 1 gating, standard 20-vs-250 isolation, overflow sentinel disclosure, report revocation, published numeric-only series, source branch/patient/department restrictions.
- `tests/stage-75-extended-patient-trends-mariadb.integration.test.ts`: real two-connection MariaDB, 24 visible current reports with measurements, a withdrawn report, a restricted same-tenant branch, foreign tenant, cross-order/performed branch OR scope, >20-page old value discoverability, and fail-closed value drift.
- Stage 75 MariaDB test wired to CI, preserving existing full test:safety, clinical/finance/tenant MariaDB suites, Prisma migrate/generate/status, TypeScript, lint, AR/EN UI/i18n checks and Next production build.

## Acceptance / deferred
- **No new migrations**, historical result/report rewriting, billing mutation, hidden cross-branch data or clinical policy activation.
- This phase improves cross-page trend discovery but **does not claim unbounded lifetime trends**, clinical interpretation, automated conversion or complete UAT. A later dedicated analyte-specific cursor-based explorer may be warranted for patients with >250 accessible reports.
- No production deployment is implied by GitHub CI; Hostinger deployment needs separate owner confirmation.
- Manual clinical/device/finance/provider UAT and clinical signatory governance remain deferred until full product completion, not waived or deemed passed.
- PR #128 Analyzer Bridge must remain separately OPEN/DRAFT.
