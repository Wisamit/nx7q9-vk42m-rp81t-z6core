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

## Phase 7A — Runtime accepted

Runtime acceptance confirmed on Hostinger for main commit `08f4dfd1e341d47bb234e6c2d3bb132358dc79e2`.

Phase 7A delivered version-bound PDF export and immutable report language-mode fidelity.

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


## Phase 7B — Secure outbound report delivery orchestration

Phase 7B is implemented on feature branch `phase-7b-secure-outbound-report-delivery` and is pending CI/runtime acceptance.

Scope:
- adds explicit report-version outbound delivery actions for EMAIL, SMS and WHATSAPP;
- external report messages contain no laboratory result values; they provide a secure authenticated portal link to the exact `DiagnosticReportVersion`;
- the user selects only an associated recipient type (patient, referrer or client) and channel; arbitrary free-text destinations are not accepted for clinical report delivery;
- destinations resolve server-side from the recipient's active portal account;
- outbound report delivery requires an active portal account plus an active `PortalContactVerification` whose channel and `destinationSnapshot` match the account's current email/phone; compatibility timestamps are never sufficient authorization;
- portal users can request a six-digit VERIFY_CONTACT OTP over EMAIL or SMS; successful OTP verification creates immutable destination-specific history with method `SELF_SERVICE_OTP`; challenges expire after 10 minutes, are rate-limited, have bounded attempts, and consumed/replaced OTP bodies are redacted from stored notifications;
- authorized staff with `portal_accounts.manage` can confirm a current email/phone only with an explicit reason; the actor, reason, channel, masked destination and verification record are audited as `STAFF_CONFIRMED`;
- existing `contactVerifiedAt`, `emailVerifiedAt` and `phoneVerifiedAt` remain compatibility/cache fields and are not the source of truth for report-delivery authorization;
- migration preserves safe historical verification as `LEGACY_IMPORTED`: channel-specific timestamps are bound to their current destination, while the legacy aggregate marker is migrated only when exactly one contact method exists;
- a changed email/phone never inherits the previous destination's verification because authorization requires an exact current-destination match; the present application has no post-provisioning contact-edit API, so there is currently no mutation path that can change these fields without a new implementation explicitly handling revocation;
- doctor delivery is allowed only to the order's associated referrer;
- corporate delivery additionally requires active `CorporatePortalPatientAccess.canViewReports` for the order patient;
- report-delivery events are linked one-to-one to the corresponding notification delivery, preserving queue/provider traceability;
- report delivery starts as QUEUED, changes to SENT only after provider-gateway success, and changes to FAILED only when delivery is terminal/skipped; retryable failures remain QUEUED;
- if a gateway explicitly returns `delivered=true` or status `DELIVERED`, the linked report-delivery event is reconciled to DELIVERED;
- provider message IDs are copied to `ReportDeliveryEvent.externalRef`;
- only the latest non-retracted report version can be newly queued for outbound delivery, preventing accidental transmission of a superseded clinical report;
- authenticated patient/doctor/corporate portal views create `PORTAL / DELIVERED` evidence on the exact report version in addition to the audit event;
- notification dispatch is scoped to the caller's organization and dashboard delivery counts are organization-scoped;
- dispatcher claims each delivery atomically before contacting a provider to reduce duplicate sends during concurrent dispatch runs;
- templates use event code `REPORT_RELEASED` and support `{{recipientName}}`, `{{patientName}}`, `{{accessionNumber}}`, `{{reportVersion}}`, `{{reportStatus}}` and `{{portalUrl}}`;
- safe bilingual fallback messages are used when no enabled channel template exists.

Clinical/privacy guardrails:
- SMS/WhatsApp/email bodies do not embed clinical values, reference intervals, flags or result comments;
- the public QR verification endpoint is not used as a replacement for authenticated report delivery;
- retracted report versions cannot be queued for external delivery;
- queue audit records mask the destination even though the authorized report delivery event retains the actual destination required for operational evidence;
- provider-backed sending remains infrastructure-dependent and cannot be declared Production Accepted until real gateway credentials are tested.

Remaining Phase 7 after 7B:
1. any remaining report-template/signature fidelity gaps found by evidence audit;
2. provider-backed EMAIL/SMS/WHATSAPP acceptance in the deployment environment;
3. close Phase 7 application scope only after runtime acceptance of 7B and explicit infrastructure status documentation.

### Phase 7B contact-verification reconciliation

PR #114 is not to be merged directly because it diverged from the already merged PR #115 implementation. The reconciled design is built from current main and preserves #115 self-service OTP while adding destination-bound immutable verification history inspired by #114.

Safety invariant:
- report authorization checks the exact current email/phone against a non-revoked verification record;
- changing a destination cannot inherit an old verification even if compatibility timestamp fields remain populated;
- EMAIL verification does not authorize PHONE/SMS/WhatsApp and PHONE verification does not authorize EMAIL;
- staff confirmation and self-service OTP both produce auditable verification-history records;
- legacy ambiguous accounts with both contacts and only the aggregate `contactVerifiedAt` receive no inferred channel verification.

Runtime acceptance remains separate from CI/deployment completion and requires explicit Hostinger functional confirmation.
