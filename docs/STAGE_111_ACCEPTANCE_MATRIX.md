# Stage 111 — Controlled latest-version report discovery and print-audit queue

**Base main:** `6cdb64ad5676c2527d9c6fe03a028726cf9f318a` (Stage 110 deployed successfully to Hostinger, owner confirmed; main CI #1218 SUCCESS).

## Verified Master Scope gap

- `02_MASTER_SCOPE.md` §§40–45, §72, §73, §80 and legacy report printing/not-printed queue parity.
- The prior `/reports` page listed the newest version for each report but lacked a usable, branch-filterable print work queue, date/status/accession filters and correct print-evidence distinction after an amended or retracted version.
- A recorded `PRINT/RECORDED` event is evidence **only** of a browser print request, not proof that paper was printed or delivered. Do not silently promote an audit event to physical-print confirmation.

## Implemented

1. New read-only `src/lib/report-print-queue.ts` validates page/branch/status/print/UTC-date/exact accession. Duplicate/invalid filters or unauthorized branch requests fail closed rather than showing all branches.
2. Report IDs are selected from a parameterized, tenant- and branch-scoped SQL join of `diagnostic_reports` + `orders` + **only the diagnostic report version matching `current_version`**. No historical version's print event can satisfy the current version's print predicate.
3. Latest-version print filters: all, `PRINT/RECORDED` event exists, or no recorded print event. Current `RETRACTED` versions are never included as outstanding print work, although they remain discoverable through explicit normal/retracted filters.
4. Search only exact accession, branch, report status, and UTC-issued date range. Count and page use the same predicates; pagination is stable by issued timestamp and version ID; all values are positional SQL parameters, not interpolated SQL.
5. The queue displays **immutable patient identity from `DiagnosticReportVersion.contentSnapshot`**, not live patient demographics that may have been edited/merged later. Missing historical snapshots display a neutral missing-value marker and never silently substitute modern patient data.
6. Bilingual Arabic/English filters, status, pagination, actions and explanatory warnings. This page is strictly read-only; the existing report detail/print and its audit gate remain the only way to request browser printing.
7. No schema migration, historical data rewrite, printing automation, external communication or analyzer/device activity.

## Safety/acceptance evidence

- Unit/safety tests: invalid/duplicate params, cross-branch rejection, strict SQL placeholder binding, last-version joins, accession injection data, UTC bounds, historical snapshot identity, retracted handling and preserved pagination state.
- Real MariaDB integration: old printed version followed by unprinted amendment, retracted latest version, two branches, foreign organization, date/status/exact accession filters, row totals and scope narrowing.
- Required gates: full existing CI safety and MariaDB tests, Prisma migrations/status/client, TypeScript, ESLint, UI RTL/theme/i18n checks, Next production build, feature PR exact-SHA merge, independent main CI.
- Manual report printing hardware, site-specific paper delivery, real-world clinical UAT, legacy MDB parity sign-off, security review and DR evidence remain **DEFERRED** by owner until end-to-end LIS acceptance.

## Release checklist

- [ ] Final feature SHA CI SUCCESS
- [ ] Ready PR merged with exact-head compare-and-swap
- [ ] Main independent CI SUCCESS at merge SHA
- [ ] Hostinger deployed SHA confirmed separately by owner
- [ ] Operational/clinical/printing manual UAT DEFERRED, not claimed passed
