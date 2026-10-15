# Stage 130 — Cross-Module End-to-End Integration and Regression Closure

**Base:** main `e8dd79ae2ba9f69b5b6fc23282fd35b2c381a413`; Stage 129 verified by the owner on Hostinger.
**Exact assignment:** 48 Master Scope sections below. No item removed. Source of truth remains Prisma, current APIs, existing tests, and `02_MASTER_SCOPE.md`.

## Confirmed new cross-module defect and resolution

- Both individual invoice payment and corporate/client-account allocation previously used invoice CAS and cashier shift versions but **did not have durable request idempotency**. A response-loss retry with an unpaid balance could legitimately post a second payment.
- New optional-null historical columns and tenant-scoped unique `(organization_id, posting_key)` on Payment; **new API postings require a UUID v4-style key**. Each original posting keeps a SHA-256 canonical request fingerprint and response snapshot. A byte/amount-equivalent retry returns the same snapshot without another payment, allocation, shift increment or audit; changed request/actor/invoice/branch/client/currency/amount/method under the same key is rejected. Closed/fully-paid invoices can still replay, with CURRENT permission and branch scope checked.
- The browser retains the same key across uncertain network responses and creates a fresh key when payload changes. Both payment pathways handle missing/invalid key. API consumers must send `postingKey` on every NEW financial posting after deployment.
- Transaction CAS and unique-key failures roll back invoice, payment and audit together; replay after a winner commits is looked up under current tenant+actor+request fingerprint. Never convert/cross-sum currencies.
- Migration `20261015163000_payment_posting_idempotency` is additive; existing historic payments keep NULL and no records are rewritten.

## New real MariaDB end-to-end evidence

`tests/stage-130-cross-module-mariadb.integration.test.ts`: synthetic two tenants, two physical branches under first tenant, organization-wide patient referenced by two orders, test→order line→immutable invoice, specimen barcode→received destination manifest→performed-branch laboratory result→versioned diagnostic report; payer with shift/method, competing independent DB connection, rollback/unique payment key, audit exactly once, historical test label/price/report snapshot preserved after catalog edit. Tenant- and branch-scoped negative SQL assertions. This suite is **not** a physical clinical validation nor does direct SQL fixture setup substitute for API permission review.

`tests/stage-130-payment-posting-safety.test.ts`: fingerprint normalization, tenant/user/branch/method/currency/amount binding and replay snapshot correctness; checks both routes and bilingual client retry-key plumbing. Other real MariaDB module suites remain mandatory in CI; AR/EN + RTL/LTR, TypeScript, ESLint, Prisma migrations, and Next build continue to run.

## 48-section Master Scope software evidence map

| § | Requirement | Regression evidence / existing modules |
| --- | --- | --- |
| 1 | Organization/branch | orders, patient, result joins; stage-102 organization MariaDB |
| 3 | Central patient identity | stage-130 two orders, one MRN across branches; stage-73 merge lineage |
| 4 | Longitudinal history | stage-130 same patient cross-branch; stages 71–77 history tests |
| 14 | Orders | stage-130 ordered-branch and frozen line; order route, Stage 127 |
| 15 | Order questions | order-questions tests and order creation route |
| 16 | Internal billing | stage-130 invoice-line/payment allocation/cashier plus replay-key safety |
| 18 | Discount approvals | discount approval safety and staged order pricing tests |
| 19 | Credit accounts | client-credit-control; client-payment/aging routes; analytics tests |
| 20 | Specimen requirements | specimen-requirement-engine tests and order registration |
| 21 | Barcode/accession | stage-130 barcode and unique specimen order linkage |
| 22 | Phlebotomy | specimen-storage MariaDB and specimen collection safety tests |
| 23 | Home collection | digital-services and stage-90 home-collection custody MariaDB |
| 24 | Reception | specimen-reception-policy and transfer receipt MariaDB |
| 25 | Rejection/recollection | specimen rejection/retention integration tests |
| 26 | Aliquot | stage-22 aliquot MariaDB and volume policy tests |
| 27 | Interbranch sample transfer | stage-130 source→destination custody and specimen-transfer MariaDB |
| 28 | Shipment manifests | stage-130 manifest item and specimen cross-module join |
| 30 | Laboratory worklist | stage-81 worklist complete pagination MariaDB |
| 42 | Reports | stage-130 immutable snapshot and report-version MariaDB |
| 43 | Partial/final/amendment | report-version and stage-72 published history MariaDB |
| 44 | Cumulative reports | stage-20 cumulative, stage-74 report identity MariaDB |
| 49 | Inventory | inventory lot branch response and stock safety tests |
| 50 | Multibranch inventory | inventory transfer tests and stage-99 MariaDB |
| 51 | Lot expiry | stage-97 inventory lot safety + stage-107 recall tests |
| 52 | Procurement | inventory goods receiving and procurement MariaDB |
| 53 | Equipment | equipment-qc MariaDB |
| 54 | Maintenance | equipment-qc MariaDB and maintenance API |
| 55 | Calibration | equipment-qc MariaDB and release gate |
| 56 | QC | equipment-qc MariaDB and qc-gate |
| 57 | Westgard/LJ | qc-westgard and equipment-qc MariaDB |
| 58 | QMS | quality-management MariaDB |
| 59 | Incidents | quality-management and stage-100 quality-case MariaDB |
| 60 | CAPA | quality-management MariaDB and CAPA state safety |
| 61 | Document control | quality-management MariaDB |
| 62 | Training/competency | quality-management MariaDB |
| 65 | Dashboards | analytics MariaDB + branch scope |
| 66 | Branch comparisons | analytics MariaDB and branch filters |
| 67 | TAT | tat-policy-governance, tat-escalation, analytics MariaDB |
| 68 | Financial reporting | analytics MariaDB; financial-reporting decimal safeguards |
| 69 | Cashier shift closing | stage-130 shift and payment linkage, cashier policy |
| 70 | Profitability | analytics MariaDB and currency/cost completeness rules |
| 71 | Operational analytics | analytics MariaDB and stored TAT metrics |
| 72 | Global search | patient history/results discovery and branch-scoped paging |
| 73 | AR/EN, RTL/LTR | test:ui-i18n and test:ui-theme |
| 81 | Report designer | report-template rules and report-version snapshot tests |
| 82 | QR verification | report-version and secure verification route |
| 85 | Scheduling/queue | digital-services MariaDB |
| 86 | Currency/tax | stage-130 AED frozen, tax-policy + accounting/finance tests |

## Safety / remaining acceptance boundary

- Test setup uses **synthetic** records, no genuine patient financial or clinical data. The newly demonstrated linkage validates SQL persistence/transaction invariants. Production API flows must still pass the existing safety tests. Real clinical reference values, critical thresholds, staff signatures, calibration/WG policy, financial tariffs/taxes, provider receipts and real hardware are not assumed.
- Separate Draft PR #128 (Analyzer Bridge) and #209 (interpretation) are intentionally not merged.
- Deployment to Hostinger is strictly by owner **after** feature CI and independent main CI SUCCESS at the exact merge SHA. The production `build` runs Prisma migrations, so review and backup before deployment.
- Stage 131 reaudits all 88 sections as a software release candidate; Stage 132 is external financial/medical/device/provider/security/backup restore UAT and GO/NO-GO. Neither is falsely marked PASS by these tests.

## Release gate (fill with GitHub-verified evidence)

- [ ] Feature HEAD MariaDB, safety, TypeScript, ESLint, AR/EN/theme and Next build pass on the **same final SHA**
- [ ] Draft PR promoted after checks; expected-head SHA merge
- [ ] Independent main push CI successful on **exact** merge SHA
- [ ] Owner confirms Hostinger deployment (not part of CI)
