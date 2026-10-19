# Family Lab — withdrawn/superseded report delivery closure

**Owner-confirmed Hostinger baseline:** `91f6bf6a680fb452142945fdfab9265e697da6aa` (successful deployment). Freeze remains in force; this is a confirmed P1 safety correction, not a new feature or numbered Stage.

## Verified unsafe paths

- Staff report page `src/app/reports/[orderId]/page.tsx` unconditionally rendered `PrintReportButton` and `ReportPdfButton` for anyone with `reports.deliver`, even when the currently displayed report was `RETRACTED`. It also rendered the outbound delivery UI despite the API's prior retracted checks. A withdrawn clinical document could be printed or downloaded with no report-visible withdrawal alert, because the existing withdrawal banner was `no-print`.
- `POST /api/reports/[versionId]/delivery` logged PRINT / DOWNLOAD requests and approved browser PDF metadata based on tenant/branch but never rechecked whether the version was current or withdrawn. Thus a stale staff page could record or initiate apparent delivery of a superseded/retracted version after clinical changes.

## Consolidated correction

- The staff report action area now exposes PRINT/PDF and outbound delivery only for the **current** report version in `PARTIAL`, `FINAL`, or `AMENDED` status, while preserving all existing permissions. Historical clinical content remains available only through the existing authorized staff view for accountability, not destructive editing.
- A `RETRACTED` report now has an explicit printable document-level warning: **WITHDRAWN REPORT — NOT VALID FOR CLINICAL USE** / **تقرير مسحوب — غير صالح للاستخدام السريري**. Historical audit and delivery history are preserved.
- Browser delivery API performs an early current-version/status check, then holds tenant-scoped `diagnostic_reports FOR UPDATE` lock and exact `diagnostic_report_versions FOR UPDATE` lock inside the same transaction *before* inserting the delivery event and audit record. Withdrawal/supersession conflicts fail closed with HTTP 409 `report_version_not_current_or_retracted`. This serializes with revisions using the report parent lock and with status edits directly on the report version row.
- Existing provider/portal delivery flows keep their separate stronger trust boundary. Browser clients still cannot assert `SENT` or `DELIVERED` and no PDF event claims physical delivery.
- No schema, migration, dependency, historical result/snapshot mutation, financial changes or scope removals.

## Evidence

- `tests/release-closure-withdrawn-report-delivery.test.ts`: source-level ordering, version/current predicates, immutable audit-before-response and AR/EN withdrawal warning.
- `tests/release-closure-withdrawn-report-delivery-mariadb.integration.test.ts`: isolated synthetic organization/branch/user/patient/order/report/version with competing MariaDB sessions; cancelled report status wins before delivery; authorized delivery transaction holds row locks against concurrent retraction; report supersession prevents future stale delivery without deleting past delivery history.
- Full CI for each exact PR and merged `main` SHA: Prisma, TS, ESLint, safety, all existing financial/clinical/provider tests, MariaDB, 88-section source matrix, 81-route source inventory, Arabic/English source guards, Next.js production build.
- GitHub CI does **not** confirm new Hostinger deployment. Only owner observation of deployment SHA confirms it.

## Open approvals

- [#265](https://github.com/Wisamit/nx7q9-vk42m-rp81t-z6core/issues/265) — actual 81-route private synthetic browser walkthrough (roles, branch boundaries, Arabic/English/RTL/LTR, responsive, print/PDF). Static manifest alone is not interactive UAT.
- [#250](https://github.com/Wisamit/nx7q9-vk42m-rp81t-z6core/issues/250) — 88 real-world UAT scenarios and seven independent clinical, finance, privacy, analyzer, DR, owner signoffs, legacy MDB review and governed §§75/86/87/88 remain OPEN / NO_GO.
- Do not claim a clinically approved Production GO or finished Software RC based on this automated correction alone.
