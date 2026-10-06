# Deep System Audit — Family Lab LIS

Date: 2026-10-06
Baseline: main after PR #71
Purpose: evidence-based audit of theme coverage, Arabic/RTL coverage, Master Scope implementation, and legacy Access workflow parity.

## Executive verdict

The application has a strong production-oriented architecture and a broad domain model, but it is not yet fully complete against the Master Scope and is not yet visually/localization-complete.

Current high-level status:
- Theme architecture: PARTIAL — central theme tokens exist, but legacy hard-coded colors remain widely used.
- Arabic/RTL: PARTIAL — navigation and several core screens are localized, but many pages and manager components still contain English-only UI.
- Legacy Access parity: PARTIAL — core business logic is recovered, but several specialized workflows and historical/operational behaviors are not yet represented in the UI.
- Master Scope parity: PARTIAL — most modules exist architecturally; several safety, billing, patient-history, administration, and operational workflows remain incomplete.
- Production approval: NOT READY until identified P0/P1 gaps and controlled pilot acceptance are completed.

## 1. Theme audit

### What is good
- Organization-level light and dark palettes exist.
- Theme values are rendered as CSS custom properties.
- Runtime theme switching exists.
- Core shell, navigation, cards, tables, inputs, settings and CRUD modals already consume theme variables in many places.
- Organization branding is configurable.

### Findings
The main global stylesheet still contains extensive direct light-theme colors and shadows instead of semantic theme tokens. The audit found 69 CSS lines outside variable definitions containing raw hex/RGB values.

Affected UI families include authentication/setup surfaces, legacy card/table styles, catalog/import review, specimen cards, transfer workflows, result entry, diagnostic report preview, status/priority badges, integration secret panels, resilience, notifications, report template preview, repeat/bulk result entry, send-out workflow, MFA/security panels, global search and workflow summaries.

The current dark theme compensates with broad selector overrides. This works for many screens but does not guarantee full coverage and makes future UI regressions likely.

### Required remediation
1. Replace direct surface/text/border colors with semantic variables.
2. Derive state backgrounds from success/warning/danger/info with color-mix.
3. Keep intentional paper/report-preview white only where the UI is explicitly representing a printable document.
4. Add semantic variables for surfaceSoft, surfaceRaised, surfaceHover, textSubtle, focusRing and overlay.
5. Add a static theme regression check to prevent new hard-coded UI colors outside approved exceptions.

Theme audit result: PARTIAL / remediation required.

## 2. Arabic / RTL audit

### What is good
- Root lang and dir change with the user locale.
- Sidebar labels are bilingual.
- Core translations were added to Dashboard, Patients, Orders, Billing, Specimens, Worklists, Pricing, Reports, Transfers, Critical Results, Microbiology, Send-outs, Inventory, Equipment, QC and Quality.
- Security/Profile and CRUD modals have bilingual support.
- Shared status/priority/sex Arabic labels exist.

### Confirmed untranslated or partially translated top-level pages
The following pages still contain significant user-facing English:
- /digital-services
- /catalog
- /report-templates
- /clinical-rules
- /integrations
- /analytics
- /notifications
- /resilience
- /search
- patient detail /patients/[id]
- order detail /orders/[id]
- test detail /catalog/tests/[id]
- import review /catalog/imports/[id]
- microbiology case /microbiology/[id]
- released report page /reports/[orderId]
- result workbench /worklists/[orderItemId]
- patient/doctor/corporate portal screens
- queue display
- public report verification
- inventory operations/procurement/transfers

### Confirmed untranslated manager components
Large components with English-only or largely English UI include:
- digital-services-console
- specimen-actions
- transfer-manager
- bulk-result-entry
- microbiology-manager
- send-out-manager
- catalog-manager
- clinical-catalog-manager
- commercial-package-manager
- report-template-manager
- clinical rules managers
- analyzer-manager
- integration-manager
- inventory-manager
- equipment-manager
- qc-manager
- quality-management-console
- notification-center-actions
- resilience-manager

### Required remediation
1. Localize all route pages and imported interactive components.
2. Localize status/method/type/category labels instead of exposing enum codes.
3. Localize placeholders, confirmations, validation errors, empty states and success messages.
4. Localize portal/public pages independently from staff locale.
5. Add an Arabic coverage regression test/manifest.
6. Verify RTL layout for tables, dialogs, charts, report preview and dense forms.

Arabic audit result: PARTIAL / substantial remediation required.

## 3. Legacy Access parity audit

The raw Access MDB and the legacy analysis confirm these important behaviors:
- order/visit registration
- selected tests and profiles
- source-dependent pricing
- payments, discounts, invoice/change tracking
- generic and specialty result entry
- result/profile completion flags
- age/sex/age-unit reference range selection
- reusable comments
- report configuration and printing
- printed/not-printed tracking
- pending/incomplete result queries
- culture organisms/antibiotics
- history screens
- calculation screens
- glucose history
- old semen history
- many specialty-specific forms and reports

### Legacy capabilities recovered well
- test catalog -> normalized LabTest/TestComponent
- profiles/panels/packages
- units/specimen/container/method configuration
- age/sex reference intervals
- generic result storage
- critical values and validation
- comments/templates
- organism/antibiotic/susceptibility workflow
- report versioning
- print/delivery event logging
- pending worklists
- source/referrer master data
- multi-branch capabilities beyond the old system

### Legacy parity gaps
1. Source-based pricing is not directly represented in PriceListScope. Current precedence supports CONTRACT > CLIENT > BRANCH > ORGANIZATION. Legacy price.sorcee and Master Scope require sources/campaigns to select/override pricing.
2. Specialized result-entry UX is incomplete. Legacy had dedicated forms/tables for CBC, urine, stool, semen/fertility, coagulation, thyroid, tumor markers, TORCH, Widal, ZN, CSF, marrow and others. Current TestWorkflowType only exposes GENERAL and MICROBIOLOGY.
3. Longitudinal/history UX is incomplete. Raw MDB contains History, glucosehis and seminOld. Current patient detail does not provide complete longitudinal orders/results/reports/invoices/payments/trends/amendments.
4. Legacy printed/not-printed behavior is structurally replaced by ReportDeliveryEvent, which is good, but report queue/find-and-print parity should be verified in UI.
5. Legacy discount/payment/change behavior is only partially recovered. Payments/invoices exist, but discount approvals/refunds/credit notes/cashier workflows remain incomplete.
6. Legacy delivery/promised date (Deleveary) is not represented as an explicit order/report promised-delivery workflow.

Legacy parity result: PARTIAL.

## 4. Master Scope / Roadmap audit

### Phase 1 — Foundation
Status: PARTIAL
Implemented: authentication, users/roles/permissions, organizations/branches/departments schema, branch scope, audit, settings, MFA, migrations.
Gaps: branch administration UI/API, department administration UI/API, department-scope assignment in user administration, complete localization.

### Phase 2 — Master Data / Test Catalog
Status: PARTIAL
Implemented: tests/components/panels/packages, units/specimen types/containers/methods, branch availability, ranges/critical numeric limits, comments, catalog import.
Gaps: configuration export, richer report-display/test layout rules, reference interval criteria for pregnancy/gestational age/specimen/analyzer/population, qualitative/text critical-limit rules, branch-specific TAT override.

### Phase 3 — Patients and Referrers
Status: PARTIAL
Implemented: central patient master, identifiers, duplicate detection, referrers/clients/sources.
Gaps: patient merge, full address/WhatsApp/notes/clinical-information fields, creation branch trace, longitudinal history, trends, attachment history view.

### Phase 4 — Orders and Billing
Status: PARTIAL
Implemented: orders/items/packages/questions, priority, price lists, invoices, payments, allocations/split-payment architecture, currency snapshots.
Gaps: source/campaign pricing scope, discount authority/approval workflow, refunds workflow, credit notes, credit-account statements/aging/limits, cashier shifts/closing, configurable tax rules.

### Phase 5 — Specimens and Barcodes
Status: PARTIAL
Implemented: specimen requirement planning, organization-unique barcode, collection/receipt/rejection/recollection, event history, transfers.
Gaps: aliquot UI/API workflow despite parent/child schema support, barcode/label printing workflow, explicit receipt condition/temperature/discrepancy UX, failed-collection workflow.

### Phase 6 — Core Laboratory Results
Status: PARTIAL
Implemented: department worklists, generic/manual entry, bulk entry, reference flags, criticals, comments, delta checks, verification/release/amendment.
Gaps: specialty-optimized UIs beyond microbiology, technical-review vs medical-validation stages are collapsed into a simpler status path, configurable validation paths by department/test need richer workflow support.

### Phase 7 — Reports and Delivery
Status: PARTIAL / STRONG
Implemented: immutable report versions, partial/final/amended/retracted report status support, report templates, branch template support, QR verification, print/download/email/SMS/WhatsApp/portal delivery event model.
Gaps: verify actual generated PDF workflow vs browser print, actual outbound email/SMS/WhatsApp provider execution remains framework-level, electronic signature/re-authentication metadata for high-risk approval.

### Phase 8 — Multi-Branch Logistics
Status: STRONG PARTIAL
Implemented: performed branch, inter-branch manifests, dispatch/receive, chain of custody, send-out labs.
Gaps: policy-driven routing/central-lab assignment, richer branch operational dashboard, temperature/seal/signature reconciliation details.

### Phase 9 — Microbiology
Status: MOSTLY IMPLEMENTED
Implemented: cases, observations, isolates, organisms, antibiotics, susceptibility, MIC/zone model, final/withdraw workflow.
Remaining: confirm preliminary reporting UX and full bilingual/specialized report presentation.

### Phase 10 — Analyzer Integration
Status: PARTIAL
Implemented: analyzer registry, credentials, mappings, raw messages, import staging, replay/error handling, HL7/ASTM-oriented architecture.
Gaps: deployable physical Analyzer Bridge implementation is not part of this web application, bidirectional outbound orders are not implemented end-to-end, real analyzer acceptance testing is pending.

### Phase 11 — Advanced Clinical Rules
Status: STRONG
Implemented: calculated rules, reflex rules, delta, validation holds, autoverification policies, critical escalation, QC gating.
Remaining: controlled real-world validation and richer authoring UX.

### Phase 12 — Inventory & Procurement
Status: STRONG PARTIAL
Implemented: items/categories/suppliers, lots/expiry, branch stock, movements, transfers, purchase requests/orders, receipts, approvals, consumption endpoint.
Remaining: complete Arabic/theme UX, verify supplier invoice/cost/accounting detail against operational need, verify test-level automatic consumption policy.

### Phase 13 — Equipment & QC
Status: STRONG
Implemented: equipment, maintenance plans/events, documents, calibration, downtime, QC materials/lots/targets/runs/results, Westgard violations, Levey-Jennings, release gating.
Remaining: UI localization/theme cleanup and pilot evidence.

### Phase 14 — Quality Management
Status: STRONG
Implemented: nonconformance, CAPA/actions/review, document control/version workflow, training, competency, analyzer authorization, indicators, audits/findings.
Remaining: UI localization/theme cleanup and pilot evidence.

### Phase 15 — Portals & Digital Services
Status: PARTIAL
Implemented: portal account model for PATIENT/DOCTOR/CORPORATE, portal sessions, appointments, home collection, queue, corporate patient access.
Gaps: portal Arabic coverage, full doctor/corporate workflow verification, OTP/MFA user experience not exposed end-to-end despite OTP schema, complete portal financial/report authorization acceptance testing.

### Phase 16 — Analytics & Management
Status: STRONG PARTIAL
Implemented: branch comparison, financial KPIs, source/referrer analytics, profitability coverage, TAT/rejection/critical/QC KPIs.
Gaps: patient longitudinal trends/cumulative clinical reports, full localization/theme coverage, validate all requested filters.

### Phase 17 — Interoperability
Status: STRONG PARTIAL
Implemented: FHIR R4 Patient/ServiceRequest/Observation/DiagnosticReport endpoints, metadata, HL7 inbound, terminology mapping, API keys, endpoints, webhooks, integration message queues.
Remaining: partner-specific conformance tests, outbound clinical workflows where needed, production interface security/operational evidence.

### Phase 18 — Resilience and Scale
Status: ARCHITECTURE IMPLEMENTED / OPERATIONAL EVIDENCE PENDING
Implemented: retention policies, backup evidence, DR drill records, branch continuity policy, edge nodes/queues, health endpoints.
Remaining: actual infrastructure backup scheduling is outside the LIS, real restore test evidence, RPO/RTO verification, performance/load evidence.

## 5. High-priority gaps

### P0 — Clinical/billing/data-integrity
1. Source/campaign pricing override missing.
2. Reference interval criteria incomplete for pregnancy/gestational age/specimen/analyzer/population.
3. Patient merge workflow absent.
4. Discount/refund/credit-note workflows incomplete.
5. Department scope exists in schema but is not managed in staff administration.
6. Real restore/DR evidence pending before production approval.

### P1 — Operational parity
1. Patient longitudinal history and trends.
2. Aliquot workflow.
3. Barcode/label printing.
4. Specialty result-entry layouts.
5. Branch/department administration.
6. Cashier closing and credit-account statements/aging.
7. Actual outbound notification/provider execution.
8. Bidirectional analyzer order workflow.
9. Configuration export.

### P1 — UX / localization
1. Complete semantic theme token migration.
2. Complete Arabic translation of every staff/public page and manager component.
3. RTL review of dense workflows and report/portal pages.
4. Replace raw enum codes with localized labels.
5. Add regression checks for theme and localization.

## 6. Recommended correction order

1. Theme token cleanup + automated theme guard.
2. Complete Arabic/RTL coverage + localization guard.
3. Source pricing + billing gaps.
4. Patient master merge/history/trends.
5. Reference interval criteria expansion.
6. Branch/department administration and department-scoped authorization UI.
7. Specimen aliquot/label-printing/reception detail.
8. Specialty result layouts.
9. Cashier/credit/refund workflows.
10. Portal/analyzer/notification operational completion.
11. Controlled pilot acceptance.
12. Restore/DR and real analyzer acceptance before Production Approved.

## 7. Audit rule going forward

A feature is not considered complete merely because a table/model exists.

For a scope item to be marked complete it must have, where applicable:
- schema
- server-side validation/business logic
- permission enforcement
- audit trail
- UI/operational workflow
- historical integrity behavior
- automated safety tests
- controlled runtime acceptance evidence
