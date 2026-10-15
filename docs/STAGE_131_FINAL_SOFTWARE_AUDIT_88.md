# Stage 131 — Final Source Audit of All 88 Master Scope Sections (Software RC)

**Audited baseline:** `main` `32d511b4fbfd307931f3d0ec9c8b42344ff8c649` (owner deployed Stage 130; independent main CI #1349 SUCCESS). **Authoritative:** Project file `02_MASTER_SCOPE.md`, 88 numbered sections; existing Stage 125 audit is historical. **Repository:** `Wisamit/nx7q9-vk42m-rp81t-z6core` ONLY.

## Interpretation / quality of evidence

- `SOFTWARE_READY`: source and automated tests exist for the code foundation; **not** clinical, regulatory or deployment UAT PASS.
- `APPROVAL_DEPENDENT`: software workflow evidenced, qualified lab/finance/policy approval required.
- `VENDOR_OR_REAL_WORLD_DEPENDENT`: code foundation evidenced; actual external system/equipment/physical acceptance outstanding.
- `BUSINESS_RULE_OR_DATA_UNRESOLVED`: do not activate live until configuration/translation, substantive source-data evidence or signoff is supplied. May require further software adaptation once qualified rules are known.
- `SOFTWARE_BLOCKER`: a confirmed engineering failure that must be closed before coding freeze. Stage 131 payment replay deficiency is addressed in this PR, pending exact CI.

This matrix maps one verified **source anchor** and one nearby automated **regression test** when available. A test named in a row is **not** proof of every bullet in that section. Missing direct test references are disclosed; this is not a fabricated claim of 88 individually executed end-to-end journeys. Run-wide CI also executes safety, MariaDB, TypeScript, lint, AR/EN and Next build.

## Full 88-section audit

| § | Master Scope section | Audited repository source | Regression evidence | Current classification | Unresolved qualification / boundary |
| ---: | --- | --- | --- | --- | --- |
| 1 | Organization and branch structure | `src/lib/branch-administration.ts` | `tests/stage-102-organization-structure-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Actual workstation, department and branch operating policies need owner approval |
| 2 | Multi-branch behavior | `src/lib/auth.ts` | `tests/stage-102-organization-structure-mariadb.integration.test.ts` | `SOFTWARE_READY` | Cross-branch user roles and operating scopes must be configured |
| 3 | Patient Master | `src/lib/patient-merge.ts` | `tests/stage-73-patient-merge-lineage-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Patient matching and merge authority require lab/privacy signoff |
| 4 | Patient longitudinal history | `src/lib/patient-history.ts` | `tests/stage-77-history-repeatable-read-consistency.test.ts` | `APPROVAL_DEPENDENT` | Comparable trends and disclosure of amended values need clinical signoff |
| 5 | Referrers and clients | `src/app/api/clients/route.ts` | `tests/stage-83-legacy-client-master-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Verify imported clients and signed contractual entitlements |
| 6 | Sources and customer types | `src/app/api/sources/route.ts` | `tests/stage-118-legacy-source-coverage-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Real legacy source/client classification reconciliation pending |
| 7 | Test Catalog | `src/app/api/catalog/components/route.ts` | `tests/stage-24-catalog-configuration.test.ts` | `APPROVAL_DEPENDENT` | Real analyte names, LOINC mapping and intervals require qualified approval |
| 8 | Components, panels and packages | `src/lib/catalog-panel-membership.ts` | `tests/stage-126-panel-draft-immutability-safety.test.ts` | `APPROVAL_DEPENDENT` | Catalog bundle activation governed by professional review |
| 9 | Calculated results | `src/lib/formula-engine.ts` | No direct section-specific suite selected | `APPROVAL_DEPENDENT` | Clinical formula applicability and approval are not inferred from code |
| 10 | Reflex / rule-based testing | `src/lib/reflex-order-confirmation.ts` | `tests/stage-127-reflex-confirmation-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Triggered confirmatory tests need authorized review and explicit billable order |
| 11 | Reference intervals | `src/lib/reference-interval-governance.ts` | `tests/stage-36-range-age-overlaps-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Age/sex/method effective ranges require medical approval |
| 12 | Critical limits | `src/lib/critical-communication-claim.ts` | `tests/stage-78-critical-communication-claim.test.ts` | `APPROVAL_DEPENDENT` | Critical threshold, escalation, readback and provider contact policy approval |
| 13 | Delta checks | `src/lib/delta-check.ts` | `tests/stage-125-delta-autoverification-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Never accept unmatched historical units/method as comparable |
| 14 | Orders | `src/app/api/orders/route.ts` | `tests/order-demographic-snapshot-safety.test.ts` | `APPROVAL_DEPENDENT` | Reception and patient identification UAT needed |
| 15 | Ask-at-order questions | `src/lib/order-questions.ts` | `tests/order-questions.test.ts` | `APPROVAL_DEPENDENT` | Local test-specific questions and consent must be reviewed |
| 16 | Billing | `src/lib/payment-posting-idempotency.ts` | `tests/stage-131-payment-replay-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Refund/void replay guard and revenue accounting approval |
| 17 | Price lists | `src/lib/pricing.ts` | `tests/stage-126-package-price-draft-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Actual branch/client contractual tariffs must be signed |
| 18 | Discounts and approvals | `src/lib/discount-approval.ts` | No direct section-specific suite selected | `APPROVAL_DEPENDENT` | Authorization limits must reflect approved finance matrix |
| 19 | Credit accounts | `src/lib/client-credit-control.ts` | `tests/analytics-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Aging and credit limits need signed finance terms |
| 20 | Sample requirement engine | `src/lib/specimen-requirement-engine.ts` | `tests/specimen-requirement-engine.test.ts` | `APPROVAL_DEPENDENT` | Required tubes, collection volumes and stability need lab approval |
| 21 | Accession and barcode | `src/lib/code128.ts` | `tests/specimen-transfer-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Physical barcode label/scanner verification deferred |
| 22 | Phlebotomy / collection | `src/lib/phlebotomy-policy.ts` | `tests/specimen-storage-location.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Bedside patient identification and collection physical UAT |
| 23 | Home collection | `src/lib/home-collection-custody.ts` | `tests/stage-90-home-collection-custody-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Courier and at-home handoff physical signoff |
| 24 | Sample reception | `src/lib/specimen-reception-policy.ts` | `tests/specimen-transfer-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Receiving exception/quarantine handling to be approved |
| 25 | Sample rejection | `src/lib/specimen-reception-policy.ts` | `tests/specimen-quarantine-safety.test.ts` | `APPROVAL_DEPENDENT` | Rejected sample/recollection local SOP approval |
| 26 | Aliquots | `src/lib/specimen-volume-policy.ts` | `tests/stage-22-aliquot-concurrency.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Aliquot storage, barcodes and real remaining volume UAT |
| 27 | Inter-branch transfer | `src/app/api/transfers/route.ts` | `tests/specimen-transfer-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Courier custody and actual handover signoff |
| 28 | Shipment manifests | `src/app/api/transfers/route.ts` | `tests/specimen-transfer-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Manifest reconciliation and physical transport signoff |
| 29 | Referral/send-out laboratories | `src/app/api/send-outs/route.ts` | No direct section-specific suite selected | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Outside laboratory contracts, acceptance and verified result files |
| 30 | Laboratory worklists | `src/lib/worklist-pagination.ts` | `tests/stage-81-worklist-complete-pagination-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Performing lab staffing and turnaround policies review |
| 31 | Analyzer integration | `src/lib/analyzer-routing.ts` | `tests/analyzer-bridge-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Live ASTM/HL7 vendor mapping and instrument qualification |
| 32 | Bidirectional analyzers | `src/lib/analyzer-work-orders.ts` | `tests/stage-109-analyzer-outbound-safety.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Vendor-approved outbound order wire/ACK UAT |
| 33 | Manual result entry | `src/lib/result-value-parser.ts` | `tests/result-entry-keyboard.test.ts` | `APPROVAL_DEPENDENT` | Manual entry and discipline-specific configuration approval |
| 34 | Specialized result UIs | `src/lib/specialty-layout-review.ts` | `tests/stage-103-specialty-layout-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Per-specialty layouts and biological range expert acceptance |
| 35 | Microbiology | `src/lib/microbiology-ast.ts` | `tests/microbiology-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Actual organism panel and AST/MIC/SIR breakpoint medical approval |
| 36 | Result flags | `src/lib/result-reference.ts` | `tests/result-reference-context.test.ts` | `APPROVAL_DEPENDENT` | Interpretive critical/abnormal cutoffs require clinical approval |
| 37 | Comments and interpretive text | `src/lib/result-comments.ts` | `tests/stage-87-comment-template-revisions-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Approved, versioned language needed for report text |
| 38 | Validation | `src/lib/result-validation.ts` | `tests/result-validation-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Technical vs medical signatory policy and qualified human signoff |
| 39 | Autoverification | `src/lib/autoverification.ts` | `tests/stage-125-delta-autoverification-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Clinical policy signoff; no auto-release assumed |
| 40 | Amendments | `src/lib/report-snapshot.ts` | `tests/report-version-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Formal amendment/retraction correction workflow UAT |
| 41 | Audit trail | `src/app/api/results/[id]/release/route.ts` | `tests/stage-129-security-integrity-mariadb.integration.test.ts` | `SOFTWARE_READY` | Compliance review, immutable evidence retention and audit export |
| 42 | Reports | `src/lib/report-snapshot.ts` | `tests/report-version-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Arabic/English paper/PDF/printer validation |
| 43 | Partial/final reports | `src/lib/report-presentation.ts` | `tests/stage-72-patient-history-published-integrity.test.ts` | `APPROVAL_DEPENDENT` | Authorized status/retraction handling clinical signoff |
| 44 | Cumulative reports | `src/lib/report-cumulative.ts` | `tests/stage-20-report-cumulative-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Cross-method and unit comparability clinical signoff |
| 45 | Delivery | `src/lib/report-outbound.ts` | `tests/stage-128-provider-ack-safety.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Real SMTP/SMS/WhatsApp provider and delivery proof |
| 46 | Patient portal | `src/lib/portal-auth.ts` | `tests/digital-services-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Portal identity/OTP and disclosure/privacy UAT |
| 47 | Doctor portal | `src/lib/doctor-portal-access.ts` | `tests/stage-90-doctor-portal-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Doctor-patient consent and delegated access UAT |
| 48 | Corporate portal | `src/app/api/corporate-portal-access/route.ts` | `tests/digital-services-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Corporate client contract and privacy entitlement signoff |
| 49 | Inventory | `src/lib/inventory-lot-safety.ts` | `tests/stage-97-inventory-lot-safety-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Real on-hand inventory/stockroom reconciliation |
| 50 | Multi-branch inventory | `src/lib/inventory-lot-branch-response.ts` | `tests/stage-99-inventory-lot-branch-response-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Transferred stock and branch ledger reconciliation |
| 51 | Lot/expiry tracking | `src/lib/inventory-lot-safety.ts` | `tests/stage-107-recall-quality-worklist-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Physical lot rotation and recall traceability acceptance |
| 52 | Procurement | `src/app/api/inventory/adjustments/route.ts` | `tests/stage-11-inventory-integrity.test.ts` | `APPROVAL_DEPENDENT` | Supplier setup and approval threshold policy |
| 53 | Equipment | `src/app/api/equipment/route.ts` | `tests/equipment-qc-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Inventory of real instruments and asset ownership proof |
| 54 | Maintenance | `src/app/api/equipment/route.ts` | `tests/equipment-qc-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Scheduled real preventive/corrective maintenance signoff |
| 55 | Calibration | `src/lib/qc-gate.ts` | `tests/equipment-qc-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Real certificates, analyzer calibration and interval signoff |
| 56 | Quality Control | `src/lib/qc-gate.ts` | `tests/equipment-qc-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | QC objectives, expiry/lot/protocol and release policy approval |
| 57 | Levey-Jennings / Westgard | `src/lib/qc-westgard.ts` | `tests/equipment-qc-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Qualified review of configured Westgard control rules |
| 58 | Quality Management | `src/lib/eqa-workflow.ts` | `tests/quality-management-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Accreditation and EQA programme external signoff |
| 59 | Incidents / nonconformance | `src/app/api/quality/analyzer-authorizations/route.ts` | `tests/quality-management-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | QMS incident classification, response and owners approval |
| 60 | CAPA | `src/app/api/quality/analyzer-authorizations/route.ts` | `tests/quality-management-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Closure and effectiveness policy signoff |
| 61 | Document control | `src/app/api/quality/analyzer-authorizations/route.ts` | `tests/quality-management-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Real SOP signatories and training/retention signoff |
| 62 | Training and competency | `src/app/api/quality/analyzer-authorizations/route.ts` | `tests/quality-management-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Current staff certificates and analyzer authorization validation |
| 63 | Users and permissions | `src/lib/auth.ts` | `tests/stage-129-security-integrity-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Live role grant review and external penetration test |
| 64 | Electronic approval/signature | `src/lib/staff-step-up.ts` | `tests/stage-110-high-risk-electronic-approval-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Designated high-risk actions and electronic signatory policy approval |
| 65 | Dashboards | `src/app/dashboard/page.tsx` | `tests/analytics-mariadb.integration.test.ts` | `SOFTWARE_READY` | Management operational KPI interpretation signoff |
| 66 | Branch comparison | `src/lib/financial-reporting.ts` | `tests/analytics-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Multi-branch report access and currency separation acceptance |
| 67 | TAT | `src/lib/tat-escalation.ts` | `tests/stage-112-promised-report-delivery-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Real branch SLAs and escalations need operational approval |
| 68 | Financial reporting | `src/lib/financial-reporting.ts` | `tests/analytics-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Finance reconcile actual refund/credit/payment totals |
| 69 | Cashier closing | `src/lib/cashier-shift-policy.ts` | `tests/stage-131-cashier-closure-safety.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Count real cash drawer, discrepancies and independent approval |
| 70 | Profitability | `src/lib/analytics-integrity.ts` | `tests/analytics-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Actual verified cost inputs needed to assert genuine profit |
| 71 | Operational analytics | `src/lib/analytics-integrity.ts` | `tests/analytics-mariadb.integration.test.ts` | `SOFTWARE_READY` | KPI interpretation and high-volume load benchmarks pending |
| 72 | Global search | `src/app/search/page.tsx` | No direct section-specific suite selected | `APPROVAL_DEPENDENT` | Central identity directory is org-wide while visit/order finance scope is branch-bound; formal PHI disclosure policy required before field use |
| 73 | Localization | `src/lib/ui-i18n.ts` | `tests/stage-130-clinical-release-safety.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Manual AR/EN translation, RTL PDF and printers UAT |
| 74 | Notifications | `src/lib/notifications.ts` | `tests/stage-128-provider-ack-safety.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Gateway keys, templates, real SMS/WhatsApp/email consent |
| 75 | Rules engine | `src/lib/validation-holds.ts` | `tests/stage-120-clinical-governance-reflex-mariadb.integration.test.ts` | `BUSINESS_RULE_OR_DATA_UNRESOLVED` | Sample interference-specific triggers need approved analyzer flag semantics; not attested as automated |
| 76 | API and interoperability | `src/lib/fhir-r4.ts` | `tests/interoperability-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Partner-approved HL7/FHIR/LOINC mapping, real ACK, egress security |
| 77 | Offline/edge readiness | `src/app/api/resilience/edge/sync/route.ts` | `tests/resilience-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Nonclinical edge buffers only; offline clinical writes intentionally disabled |
| 78 | Backup and disaster recovery | `src/app/api/resilience/backups/route.ts` | `tests/stage-129-hostinger-backup.test.mjs` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Actual offsite encrypted backup, timed isolated restore, RPO/RTO not yet evidenced |
| 79 | Security | `src/lib/integration-auth.ts` | `tests/stage-129-security-integrity-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Hostinger TLS/WAF/secrets/rotation and independent pentest needed |
| 80 | Historical integrity | `src/lib/report-snapshot.ts` | `tests/stage-130-cross-module-mariadb.integration.test.ts` | `APPROVAL_DEPENDENT` | Immutable financial/clinical snapshots; reconcile restored production history |
| 81 | Report template designer | `src/lib/report-template.ts` | No direct section-specific suite selected | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Printer, branding, bilingual released template acceptance |
| 82 | QR verification | `src/app/verify/report/[token]/page.tsx` | `tests/report-version-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Public verification host/TLS/QR scan acceptance |
| 83 | Attachments | `src/lib/attachment-integrity.ts` | `tests/stage-129-security-integrity-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Real attachment restore binary equality and access signoff |
| 84 | Future specialty readiness | `src/lib/result-entry-layout.ts` | `tests/stage-103-specialty-layout-mariadb.integration.test.ts` | `SOFTWARE_READY` | New specialty clinical protocols require later explicit configuration |
| 85 | Scheduling and queue | `src/app/api/queue/route.ts` | `tests/digital-services-mariadb.integration.test.ts` | `VENDOR_OR_REAL_WORLD_DEPENDENT` | Real queue displays and branch scheduling UAT |
| 86 | Currency/tax readiness | `src/lib/tax-policy.ts` | `tests/analytics-mariadb.integration.test.ts` | `BUSINESS_RULE_OR_DATA_UNRESOLVED` | Actual jurisdictional tax treatment and permitted currencies must be approved |
| 87 | Configuration import/export | `src/lib/catalog-composite-bundle.ts` | `tests/stage-117-composite-bundle-mariadb.integration.test.ts` | `BUSINESS_RULE_OR_DATA_UNRESOLVED` | Excel-native XLSX and bundle activation parity not attested; guarded CSV review supports staged configuration |
| 88 | Migration from legacy Family Lab | `src/lib/legacy-import-ledger.ts` | `tests/stage-126-legacy-row-lineage-mariadb.integration.test.ts` | `BUSINESS_RULE_OR_DATA_UNRESOLVED` | Actual source-row parity, clinical master approval and optional historical cutover not completed |

## High-severity engineering review / changes delivered in Stage 131

1. Re-examined Stage 130 payment posting behavior in both single-invoice and client-account routes, after actual source review. Exact successful replay on already **PAID** invoices is supported before checking current payable status; **this behavior is retained**.
2. Confirmed new gap: a previously successful payment can subsequently become `REFUNDED`, `VOIDED`, or partially refunded while original `posting_response_snapshot` remains `ok`. The same client retry key previously returned an obsolete success report, falsely appearing current. Stage 131 gates replay on persisted `Payment.status`, `refundedAmount` and snapshot payment ID; altered status returns 409 `payment_posting_state_changed`, not a duplicate posting. Both bilingual UI surfaces tell cashier to review history; no destructive financial rewrite.
3. Existing tenant-scoped unique index, CAS invoice/shift mutation, audit event, transaction rollback, branch checks, and clinical report-release custody lock remain unchanged. New `tests/stage-131-payment-replay-mariadb.integration.test.ts` includes **two real independent MariaDB connections**, lock conflict, refund/void transitions, same-key duplicate constraint and cross-tenant isolation. New source/safety tests supplement Stage 130 suites.
4. Cross-reviewed clinical quarantine-before-release, current branch/department permissions, report versioning and patient longitudinal snapshots, analyzer QC and Delta fail-closed decisions, legacy row-lineage governance, signed external delivery ACK and restricted encrypted backup. No production database access or live medical data were used.
5. No schema migration in Stage 131. No deletion/amendment of released results, invoices, backups, historic prices, report snapshots, reference ranges or translations. No merging of Draft PR #128 or #209.

## Additional Stage 131 audit of cashier close + central patient discovery

- `tests/stage-131-cashier-closure-safety.test.ts` validates DECIMAL-scale accounting, negative variance, branch/cashier/currency fencing, closing CAS version and independent review (no self-approval). Real cash verification remains Stage 132.
- `src/app/search/page.tsx` and `src/app/patients/page.tsx` intentionally discover **organization-wide patient identity** whereas order/invoice search is branch-scoped. This distinction can prevent duplicate patients across branches, but phone/ID visibility is sensitive. Do **not** silently restrict shared master identity, or infer permission to see cross-branch clinical records; owner/privacy policy for receptionist directory disclosure must be resolved in Stage 132. A generic worklist paging test is **not** evidence for search privacy.
- The verified public QR page is `src/app/verify/report/[token]/page.tsx`, not an unrelated report-delivery API; the resilience edge source is `src/app/api/resilience/edge/sync/route.ts`, not backup evidence. These exact anchors have been corrected in the matrix.

## Constraints not allowed to masquerade as release acceptance

- **§§7–13, 34–39, 57, 64, 75** — clinicians must approve test-specific reference/critical/Delta/formula/reflex/interference, Westgard and high-risk signatory policies. `validation-holds.ts` supports general hold conditions, but dedicated analyzer *sample-interference flag* automations are **not attested**; do not invent detection rules. If experts require new detection semantics, treat as remaining code work rather than silently reducing scope.
- **§§16–19, 68–70, 86** — finance must approve tariff, credit, tax, refunds, closing and profitability source data; all original currencies stay distinct, DECIMAL exactness retained.
- **§§21–29, 31–32, 42, 45–48, 53–57, 73–74, 76–79, 82–83, 85** — actual scanners/analyzers/labels/printers/provider receipts, partner consent, TLS/WAF/firewall, access review, real attachment restore and independent pentest require Stage 132 evidence. No manual tests in Stage 131.
- **§§87–88** — source MDB is a configuration reference, **not reliable clinical patient/result history**. Hashed source-row evidence and restricted staged imports are not a completed MDB cutover. Native `.xlsx` parity and selected bundle activation are **not attested** by Stage 131; no unapproved mass-import activation.
- **§77** — nonclinical offline/edge capability only, not a verified offline clinical branch.
- **§78** — GitHub CI archive crypto checks, NOT proof the owner configured Hostinger encrypted offsite remote, immutable retention, schedules, independent download or timed restore. Require actual RPO/RTO decision and restore evidence.

## Release-candidate hold / Stage 132 handoff

This stage verifies the **software implementation state** and identifies unclosed external approvals / configurable special capabilities. Mark a `SOFTWARE_READY` row as code-evidenced only; none of the 88 sections is declared final human UAT PASS. Any mandatory policy or vendor work identified at Stage 132 must be resolved before clinical production GO. `Stage 132` is explicitly a separate acceptance decision, not an automatic transition triggered by CI.

**Code validation required:** real MariaDB migrate/status/generate, all safety and regression suites, TypeScript, ESLint, Arabic/English/RTL/theme, Next production build, exact-head CI, expected-SHA merge and new `main` CI successful on merge SHA. Hostinger deployment is owner-confirmed separately.

**Status counts:** APPROVAL_DEPENDENT=48; SOFTWARE_READY=5; VENDOR_OR_REAL_WORLD_DEPENDENT=31; BUSINESS_RULE_OR_DATA_UNRESOLVED=4 (88 total).
