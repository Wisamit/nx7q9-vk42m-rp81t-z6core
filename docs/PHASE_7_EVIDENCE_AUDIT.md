# Phase 7 Evidence Audit — Reports and Delivery

Baseline audited: `e9f6f433290b45beb75997dac94eb45db1a014bd`

Authoritative roadmap scope:
- report templates
- bilingual PDF
- branch headers
- signatures
- QR verification
- partial/final reports
- amended reports
- printing
- email/WhatsApp/SMS integration framework
- delivery logs

## Evidence matrix

| Scope item | Baseline status | Evidence | Gap / note |
| --- | --- | --- | --- |
| Report templates | Implemented | `ReportTemplate`, `ReportTemplateVersion`, `/report-templates`, effective-date resolver | Released report versions snapshot the exact effective template version. |
| Bilingual report rendering | Partial | report snapshot contains Arabic/English names; report page renders bilingual content | Baseline stores `languageMode` but does not enforce it consistently; rendering follows viewer UI locale in several places. |
| PDF | Gap | printable HTML report only | Baseline has no explicit version-bound PDF download/export action; browser print may save to PDF manually but is not an audited PDF delivery artifact. |
| Branch headers | Implemented | ordering-branch identity is snapshotted into report content; branch-specific default templates supported | Historical branch identity is preserved in released report snapshots. |
| Signatures / validator context | Implemented foundation | result snapshot stores technical/medical/verified/released actors and timestamps; template can show/hide signature metadata | Current report renders validator/releaser identity as controlled signature context, not destructive live lookup. |
| QR verification | Implemented | immutable per-version verification token + limited public verification page + QR in report template | QR can be disabled by template snapshot. |
| Partial/final reports | Implemented | release snapshot counts released vs total order items and versions status as PARTIAL/FINAL | Each subsequent release creates a new report version. |
| Amended reports | Implemented | amendment-only result workflow; new report version status AMENDED; prior versions retained | Amendment reason is retained. |
| Printing | Implemented foundation | report print CSS + Print button + delivery event | Baseline print action records PRINT but does not fail closed if logging fails and text is not localized. |
| Email/SMS/WhatsApp integration framework | Implemented foundation | notification channel queue, retry/dead-letter dispatcher, gateway configuration | Provider credentials/gateways remain infrastructure acceptance. Report-specific outbound delivery orchestration still requires audit. |
| Delivery logs | Implemented foundation | `ReportDeliveryEvent`, report delivery API and report history table | Baseline delivery endpoint is organization-scoped but lacks an explicit branch-scope check. |
| Longitudinal/trend report | Outside Phase 7 roadmap / master-scope gap | patient history scope requires result trends | Track separately; do not silently redefine Phase 7. |

## Phase 7A — Version-bound PDF fidelity and export

Phase 7A is implemented on feature branch `phase-7a-version-bound-pdf-export` and is pending CI/runtime acceptance.

Scope:
- applies the immutable report-template `languageMode` to released report rendering;
- ENGLISH and ARABIC templates override the viewer's UI locale;
- BILINGUAL mode keeps the viewer locale as the primary label language and shows the alternate configured name where applicable;
- report headers and footers obey the template language mode;
- adds a browser-generated PDF download built from the immutable `DiagnosticReportVersion` report surface;
- Arabic is rasterized from the browser-rendered report, so the PDF does not depend on a server-side Arabic font package or Hostinger Chromium installation;
- page slicing creates A4 pages and optional page numbers according to the snapshotted template;
- each PDF export records a DOWNLOAD delivery event with filename, MIME type, page count, renderer identifier and SHA-256 digest;
- the PDF download is fail-closed when the delivery event cannot be audit-logged;
- report printing is also fail-closed if its PRINT delivery event cannot be recorded;
- report delivery logging now enforces the user's branch scope in addition to organization and permission checks.

Historical-integrity rule:
PDF generation reads the already-released report version surface derived from `contentSnapshot` and `templateSnapshot`. It must never rebuild historical values from the current test catalog, current reference intervals, current names, current units or a newer template version.

Known operational constraint:
external template images/logos used in browser PDF capture must be browser-accessible with suitable CORS behavior. Same-origin or controlled asset storage is preferred.

## Remaining Phase 7 audit after 7A

After runtime acceptance of 7A, audit and close:
1. report-specific EMAIL/SMS/WHATSAPP dispatch orchestration and delivery-state reconciliation;
2. patient/doctor/corporate portal report-delivery evidence where required;
3. any remaining report-template fidelity gaps;
4. provider-backed infrastructure acceptance remains environment-specific and must not be declared complete without real provider tests.
