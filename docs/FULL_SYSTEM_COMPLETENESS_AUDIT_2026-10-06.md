# Family Lab LIS — Full System Completeness Audit

Date: 2026-10-06  
Audited branch: `main` after PR #71  
Audit basis:
- current Next.js/Prisma repository tree
- Prisma schema (156 models / 112 enums)
- user-facing pages and components
- `02_MASTER_SCOPE.md`
- `03_LEGACY_ACCESS_ANALYSIS.md`
- cleaned legacy `Family lab -test.mdb` object/string inspection
- production-readiness and pilot documents

## Executive conclusion

The system has a strong production-oriented architecture and covers most major LIS domains, but it is **not yet feature-complete against the Master Scope and is not yet proven data-complete against the legacy Access database**.

Three requested conclusions:

1. **Theme coverage: PARTIAL**
   - Authenticated staff UI is strongly tokenized and theme-aware.
   - Public/portal surfaces do not consistently receive organization theme settings because root theme loading currently depends on a staff session.
   - Diagnostic report print rendering should remain report-template driven rather than app-theme driven.

2. **Arabic localization: PARTIAL**
   - Navigation, shell and several core pages are localized.
   - 50 `page.tsx` routes exist; 49 substantive UI routes were inspected and 27 remain non-locale-aware.
   - 66 React UI components exist; 51 are not locale-aware. Some are technical/no-text components, but many contain hard-coded English labels, messages and placeholders.
   - Portal/public surfaces also lack a dedicated locale/RTL context independent from the staff session.

3. **Legacy/Master Scope parity: PARTIAL**
   - Generic normalized architecture is correct and should not be replaced with Access-style specialty tables.
   - Several legacy behaviors are covered.
   - Several Master Scope items and legacy workflows are still missing or only represented as schema foundations.
   - Row-by-row migration/reconciliation of all legacy catalog/ranges/prices/comments/microbiology/referrer data has not been proven complete.

---

## 1. Theme audit

### Strong coverage
- Organization-scoped light/dark palettes exist.
- Theme tokens cover background, surfaces, text, muted text, borders, primary/secondary/accent, sidebar, success/warning/danger/info.
- Derived semantic soft colors and overlay/focus tokens are generated centrally.
- Main CSS uses theme variables extensively (hundreds of `var(--fl-...)` references).
- No significant hard-coded color literals were found in audited TSX pages/components; inline styles found are primarily dimensions/layout/chart widths.
- Staff shell supports Light/Dark toggle and local preference.

### Confirmed gaps
- Root `layout.tsx` loads organization settings only when a staff session exists.
- Therefore public/unauthenticated surfaces use static fallback theme rather than organization theme:
  - staff login
  - portal login
  - portal forced password change
  - public queue display
  - public report verification
- Portal pages use portal authentication, but root layout does not derive theme/locale from portal session.
- `SYSTEM` theme is server-rendered as light initially and only corrected client-side where ThemeToggle exists; public pages do not have that correction.
- Public organization branding/theme resolution needs an explicit tenant context (organization code/domain/branch/report token), not “first organization in database”.

### Theme remediation
- Add public organization theme resolver.
- Add portal nested layout using portal account organization + preferred locale.
- Add queue display organization/branch theme resolution.
- Add report verification theme/brand resolution from report -> organization.
- Keep printable clinical report colors/layout governed by immutable report-template snapshot, not mutable app theme.
- Add automated theme token lint/check preventing new hard-coded UI colors.

---

## 2. Arabic / RTL audit

### Route-level status
Strong/localized core examples:
- dashboard
- patients list
- orders list
- billing
- specimens list
- worklists list
- critical results
- pricing
- security/settings
- users/roles
- portions of analyzers/inventory/equipment/QC/quality/microbiology/send-outs

Confirmed route-level gaps include:
- analytics
- catalog
- catalog import review
- test detail/configuration
- clinical rules
- digital services
- integrations
- inventory operations
- inventory procurement
- inventory transfers
- staff login (pre-session)
- microbiology case detail
- notifications
- order detail
- patient detail
- portal login/change-password/home
- portal report
- queue display
- report template designer
- diagnostic report detail
- resilience
- global search
- setup
- public report verification
- result-entry detail

### Component-level gaps
Hard-coded English remains in many reusable components, including:
- advanced clinical rules
- analyzer manager/import/replay UX
- attachment manager
- autoverification/validation manager
- bulk result entry
- catalog manager
- clinical catalog manager
- clinical rules manager
- commercial package manager
- critical escalation manager
- CRUD modal close label
- digital services console
- equipment manager
- integration manager
- inventory managers
- legacy import review components
- microbiology editors
- notifications
- order-question manager
- portal forms
- procurement manager
- QC manager
- quality management console
- reference-range import review
- reflex review
- report-template manager
- resilience manager
- result entry/repeat/workflow actions
- send-out manager
- specimen actions
- transfer manager
- validation-hold panel

### Localization architecture recommendation
Do not continue with scattered inline `tr(locale, en, ar)` forever.

Implement:
- centralized message catalog with stable translation keys
- server/client translation helper
- route/layout locale context
- enum/status labels centrally
- master-data bilingual fallback helper
- formatter service for date/time/number/currency
- locale-aware validation/error messages
- locale-aware portal/public layouts
- CI localization audit that fails on new hard-coded user-facing English strings unless explicitly allow-listed

---

## 3. Legacy Access parity

### Legacy capabilities recovered
The legacy MDB/analysis contains:
- order/visit registration
- test selection
- profiles/panels
- price by source
- discount/payment/change/invoice behavior
- generic result completion
- profile completion
- sex/age/age-unit reference ranges
- specialized result-entry screens
- culture/organisms/antibiotics
- predefined comments
- report configuration/printing
- pending/incomplete result tracking

Recovered specialty forms/reports include examples such as:
- CBC
- Urine
- Stool
- Semen/Fertility
- Coagulation
- Thyroid
- TORCH
- Tumor markers
- Widal
- ZN/AFB
- PCR
- CSF
- Bone marrow
- Kidney/Liver/Lipid
- Haemoglobin
- Cardiology
- Pregnancy/BHCG
- Prostata
- Culture
- Serology
- Stone
- Occult
- Hepatitis

The new system correctly does **not** reproduce one-table-per-test/specialty architecture.

### Legacy parity that is structurally covered
- test catalog -> `LabTest`
- components -> `TestComponent`
- panels/profiles -> `TestPanel`
- commercial packages -> `CommercialPackage`
- units/method/specimen/container -> normalized masters
- age/sex/effective-dated ranges -> `ReferenceInterval`
- comments -> `ResultCommentTemplate`
- organisms/antibiotics/susceptibility -> microbiology models
- referrers/sources -> `Referrer` / `OrderSource`
- historical result/report snapshot/versioning -> stronger than legacy
- branch separation/central patient model -> stronger than legacy
- audit/security -> stronger than legacy

### Confirmed legacy parity gaps
1. **Source-based pricing**
   - Legacy `price.sorcee` explicitly priced tests by source.
   - Current `PriceListScope` supports ORGANIZATION / BRANCH / CLIENT / CONTRACT only.
   - `OrderSource` is not a pricing scope.
   - Financial precedence must be explicitly designed before implementation.

2. **Specialized result-entry UX**
   - Current generic result entry + dedicated microbiology does not reproduce the operational UX of legacy specialty screens.
   - Need optimized configurable views for CBC, urine, stool, semen/fertility, coagulation, Widal, TORCH, tumor markers, PCR, bone marrow, CSF, etc.

3. **Specialized report behavior/layout**
   - Legacy contains many `Report_*` objects.
   - New report-template system is structurally capable, but individual legacy specialty layouts/content behavior have not been reconstructed and reconciled.

4. **Legacy master-data migration completeness**
   - Migration staging/tooling exists.
   - Current migration document explicitly started with TEST/PANEL/UNIT/CONTAINER/REFERENCE_INTERVAL.
   - Full migration/reconciliation of PRICE, COMMENT, REFERRER, ORGANISM, ANTIBIOTIC and every specialty range/configuration row is not proven complete.

5. **Legacy report/comment text**
   - Access contains substantial specialty text/comment content.
   - Presence in the new production catalog/template/comment masters has not been reconciled row-by-row.

---

## 4. Master Scope gap matrix

Legend:
- **COMPLETE**: architecture + executable workflow substantially present.
- **PARTIAL**: foundation exists but scope is incomplete.
- **MISSING**: no adequate executable workflow found.
- **RUNTIME**: code exists; production/pilot evidence still required.

| # | Scope | Status | Key gap / note |
|---:|---|---|---|
| 1 | Organization/branches | COMPLETE | Core hierarchy present. |
| 2 | Multi-branch behavior | PARTIAL | Core branch model strong; branch working-hours/TAT override UX not complete. |
| 3 | Patient master | PARTIAL | Missing WhatsApp/address/notes/creation branch and merge workflow. |
| 4 | Longitudinal patient history | PARTIAL | Orders exist; consolidated history/trends/attachments/payments/amendments view incomplete. |
| 5 | Referrers/clients | COMPLETE | Core entities and contracts present. |
| 6 | Sources/customer types | PARTIAL | Sources exist; source-driven price override absent. |
| 7 | Test catalog | PARTIAL | Strong base; some report/validation/analyzer compatibility concepts live outside catalog UI. |
| 8 | Components/panels/packages | PARTIAL | Package items currently point to tests only; package -> panel inclusion absent. |
| 9 | Calculated results | COMPLETE | Formula rules and snapshots present. |
| 10 | Reflex testing | COMPLETE | Controlled recommendation workflow present. |
| 11 | Reference intervals | PARTIAL | Sex/age/method/branch/effective date supported; pregnancy/gestation/analyzer/specimen/population criteria absent. |
| 12 | Critical limits | PARTIAL | Numeric critical limits strong; textual/qualitative critical rules incomplete. |
| 13 | Delta checks | COMPLETE | Effective configurable rules present. |
| 14 | Orders | COMPLETE | Strong snapshot/branch/source/referrer/package/question handling. |
| 15 | Ask-at-order | COMPLETE | Configurable questions + historical answers. |
| 16 | Billing | PARTIAL | Invoices/payments/split allocation strong; refund/credit-note workflow incomplete. |
| 17 | Price lists | PARTIAL | Org/branch/client/contract present; source/campaign pricing gap. |
| 18 | Discounts/approvals | MISSING | Snapshot fields exist but configurable limits/reasons/approval workflow absent. |
| 19 | Credit accounts | PARTIAL | Client terms/contracts exist; statements/aging/account limits incomplete. |
| 20 | Sample requirement engine | PARTIAL | Basic specimen planning/grouping exists; advanced handling/sequence policies incomplete. |
| 21 | Accession/barcode | PARTIAL | Core order/specimen barcodes present; aliquot operational barcode workflow incomplete. |
| 22 | Phlebotomy | PARTIAL | Collect/notes/volume present; richer verification/instructions/failed draw/printer workflow incomplete. |
| 23 | Home collection | PARTIAL | Appointment/visit/collector/status exists; test/payment/route/mobile workflow incomplete. |
| 24 | Sample reception | PARTIAL | Receive/custody present; condition/temperature/discrepancy detail incomplete. |
| 25 | Sample rejection | PARTIAL | Reasons/rejection/recollection path exists; test-specific rejection and richer policy incomplete. |
| 26 | Aliquots | PARTIAL | Parent-child specimen schema exists; dedicated aliquot create/use/storage workflow absent. |
| 27 | Inter-branch transfer | PARTIAL | Core custody/dispatch/receive present; temperature/seal/signature detail incomplete. |
| 28 | Shipment manifests | PARTIAL | Manifest/items/courier/timestamps present; signatures/temp/explicit missing-vs-rejected reconciliation incomplete. |
| 29 | Send-out labs | COMPLETE | External lab/cost/TAT/result/attachment/verification workflow present. |
| 30 | Worklists | PARTIAL | Department/status queue present; analyzer/priority/TAT/due/STAT filtering incomplete. |
| 31 | Analyzer integration | COMPLETE | Bridge auth, mappings, raw logs, staging/import/replay supported. |
| 32 | Bidirectional analyzer | MISSING | No complete LIS order-download workflow to analyzer. |
| 33 | Manual result entry | PARTIAL | Generic/bulk/repeat/comments present; specialty templates and full keyboard UX need completion. |
| 34 | Specialized result UIs | MISSING | Microbiology only; legacy specialty UIs not restored. |
| 35 | Microbiology | COMPLETE | Culture/isolates/AST/MIC/zone/finalization supported. |
| 36 | Result flags | COMPLETE | Numeric/critical/abnormal/analyzer context supported. |
| 37 | Comments/interpretive text | PARTIAL | Component/test templates supported; reusable order/report scopes incomplete. |
| 38 | Validation | PARTIAL | ENTERED/VERIFIED/RELEASED exists; configurable technical vs medical validation stages absent. |
| 39 | Autoverification | COMPLETE | QC/critical/delta/hold-aware controlled policy present. |
| 40 | Amendments | COMPLETE | Versioned non-destructive amendments implemented. |
| 41 | Audit trail | COMPLETE | Strong cross-domain audit architecture. |
| 42 | Reports | PARTIAL | Snapshot/templates/QR/versioning strong; full bilingual/legacy specialty rendering still incomplete. |
| 43 | Partial/final/amended reports | PARTIAL | Status model supports them; complete operational partial-release workflow needs validation. |
| 44 | Cumulative reports | MISSING | No patient analyte trend/cumulative report workflow found. |
| 45 | Delivery | PARTIAL | Delivery model/log exists; real email/SMS/WhatsApp providers remain integration/runtime work. |
| 46 | Patient portal | PARTIAL | Core account/order/report/invoice access exists; OTP/localization/history completeness incomplete. |
| 47 | Doctor portal | PARTIAL | Account type/scoping exists; workflow depth/e-ordering incomplete. |
| 48 | Corporate portal | PARTIAL | Scoped access/bookings/reports/invoices foundation exists; statements/advanced contract behavior incomplete. |
| 49 | Inventory | COMPLETE | Core item/lot/supplier/stock/cost/storage model present. |
| 50 | Multi-branch inventory | COMPLETE | Requests/transfers/dispatch/receipt/adjustments present. |
| 51 | Lot/expiry | COMPLETE | Lot/expiry/FEFO/stock controls present. |
| 52 | Procurement | COMPLETE | PR/approval/PO/receiving implemented. |
| 53 | Equipment | COMPLETE | Asset/branch/analyzer linkage supported. |
| 54 | Maintenance | COMPLETE | Plans/events/vendor/cost/downtime/attachments supported. |
| 55 | Calibration | COMPLETE | Events/material/lot/due/status/approval supported. |
| 56 | QC | COMPLETE | Materials/lots/targets/results/users supported. |
| 57 | Levey-Jennings/Westgard | COMPLETE | Chart/rules/violations/release gating present. |
| 58 | Quality Management | COMPLETE | QMS domains implemented. |
| 59 | Incidents/nonconformance | COMPLETE | Severity/root cause/action/owner/closure supported. |
| 60 | CAPA | COMPLETE | CAPA/actions/review/effectiveness present. |
| 61 | Document control | COMPLETE | Versioned controlled-document lifecycle present. |
| 62 | Training/competency | COMPLETE | Training/competency/analyzer authorization present. |
| 63 | Users/permissions | PARTIAL / HIGH | Role + permission + branch scope enforced; Department Scope model exists but is not enforced in auth. |
| 64 | Electronic approval/signature | MISSING | No general re-auth/PIN/MFA approval-signature framework found. |
| 65 | Dashboards | PARTIAL | Branch operational dashboard present; department/central KPI breadth incomplete. |
| 66 | Branch comparison | COMPLETE | Management analytics support branch comparisons. |
| 67 | TAT | PARTIAL | Aggregate TAT exists; stage-by-stage TAT and SLA alerts incomplete. |
| 68 | Financial reporting | PARTIAL | Basic financial metrics exist; full required filters/refunds/taxes dimensions incomplete. |
| 69 | Cashier closing | MISSING | No cashier-shift/closing model or workflow found. |
| 70 | Profitability | MISSING | No complete test margin/reagent/send-out profitability workflow. |
| 71 | Operational analytics | PARTIAL | Several KPIs exist; full listed KPI coverage incomplete. |
| 72 | Global search | PARTIAL | Core entities searchable; Arabic/bilingual search behavior requires completion/runtime validation. |
| 73 | Localization | PARTIAL / HIGH | Major hard-coded English remains; public/portal RTL context incomplete. |
| 74 | Notifications | PARTIAL | In-app/outbox/templates/retries exist; real external provider delivery remains incomplete. |
| 75 | Rules engine | PARTIAL | Clinical/reflex/holds supported; interference/routing/payment/notification trigger coverage incomplete. |
| 76 | API/interoperability | COMPLETE foundation | FHIR/HL7/REST/webhooks/terminology architecture exists; partner validation is runtime work. |
| 77 | Offline/edge readiness | COMPLETE foundation | Safe non-clinical buffering architecture exists. |
| 78 | Backup/DR | PARTIAL / RUNTIME | LIS records evidence/policy; actual backup/restore is infrastructure and requires proof. |
| 79 | Security | STRONG / RUNTIME | MFA/rate-limit/secrets/session/headers strong; production evidence and department authorization remain. |
| 80 | Historical integrity | COMPLETE | Snapshot/version/effective-date patterns are strong. |
| 81 | Report template designer | COMPLETE foundation | Controlled template/version model present; UX/localization polish remains. |
| 82 | QR verification | COMPLETE | Public limited verification endpoint exists. |
| 83 | Attachments | COMPLETE | Generic target attachment architecture present. |
| 84 | Future specialty readiness | COMPLETE architecture | Generic model does not block future specialties. |
| 85 | Scheduling/queue | COMPLETE foundation | Appointments/home/onsite/queue/display exist; localization/UX remains. |
| 86 | Currency/tax readiness | PARTIAL | Currency explicit; tax snapshots exist; configurable tax-rule engine is not complete. |
| 87 | Config import/export | PARTIAL | Controlled import exists; broad controlled export is incomplete. |
| 88 | Legacy migration | PARTIAL | Staging/mapping/import foundations exist; complete row-level migration/reconciliation is not proven. |

---

## 5. Highest-priority gaps before pilot sign-off

### P0 — security / financial / data-integrity
1. Enforce department scopes end-to-end.
2. Define and implement source/campaign pricing precedence before importing legacy source prices.
3. Complete refund / credit note policy if required for pilot billing.
4. Complete discount approval model if discounts will be used.
5. Add explicit acceptance tests for public/portal organization context to avoid cross-tenant theme/branding/data mistakes.

### P1 — required product completeness
1. Finish centralized Arabic/English localization for every user-facing route/component.
2. Apply organization theme to portal/public/queue/verification surfaces.
3. Implement specialized result UX framework and priority legacy specialties.
4. Complete patient longitudinal history + cumulative trends.
5. Complete reference-range dimensions required by real catalog (pregnancy/gestation/etc.).
6. Complete TAT stages/SLA alerts.
7. Complete cashier closing if reception takes cash.
8. Complete financial reporting filters and profitability where required.

### P2 — legacy migration reconciliation
1. Extract legacy master rows.
2. Reconcile TEST / PANEL / UNIT / CONTAINER.
3. Reconcile all generic and specialty reference intervals.
4. Reconcile PRICE by source after precedence decision.
5. Reconcile COMMENT templates.
6. Reconcile organisms/antibiotics/fungi.
7. Reconcile referrers/sources.
8. Reconstruct specialty report templates and confirm clinical presentation.
9. Record counts: legacy rows -> staged -> warnings/errors -> imported -> intentionally excluded.
10. Obtain laboratory owner review/sign-off.

---

## 6. Definition of “complete”

Do not call Family Lab LIS complete until:
- every Master Scope item is either implemented or explicitly approved as deferred;
- all P0 items are closed;
- no user-facing Arabic surface contains unintended English;
- public/portal surfaces use correct organization theme/RTL;
- legacy configuration row reconciliation is documented;
- specialty workflows required by the laboratory are configured and tested;
- PA-001..PA-016 runtime pilot evidence is collected;
- backup restore and real analyzer/QC evidence are recorded;
- authorized laboratory/business owners sign off.
