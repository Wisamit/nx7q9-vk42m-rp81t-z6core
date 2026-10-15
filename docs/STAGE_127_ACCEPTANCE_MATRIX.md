# Stage 127 — Reflex Confirmation, Specialty and Clinical Safety

## Baseline and scope
- Hostinger owner-confirmed Stage 126 release `4b297a5f47a0398b2c84ce94d123c36db527ef07`, main CI #1325 SUCCESS.
- Master Scope §§9–13, 33–40, 75, 84; no removal. Branch/department isolation, central patient identity, immutable clinical/financial history and audit.
- Continue the existing clinical rules, specialist layout, microbiology, QC, critical communication, result validation and report amendment architecture. All examples are synthetic.

## Stage 127 implementation
1. A clinician must document a reason to acknowledge a triggered Reflex for review only, dismiss it, or confirm an EXISTING billed and authorized follow-up test. A review-only acknowledgment is not proof that a new test was ordered.
2. Confirm is explicitly authorized by both `reflex.review` and `orders.create`, the performing and ordering branches, and the clinical department. It binds one real `OrderItem` and matching `InvoiceLine` from the ordinary full-service order and billing workflow. No auto-order, auto-charge, or specimen fabrication.
3. The candidate must match exact organization, patient, branch and target test, valid event date, invoice issued/part-paid/paid status, exact invoice line amount/currency and configured specimen plan.
4. Optional `ReflexRuleEvent.confirmedOrderItemId` FK and `billingEvidenceSnapshot` persist a confirmation-time source snapshot. This is an evidence link, not a retroactive billing amendment.
5. Result and event row revision CAS prevent stale or competing reviews. Manual result reentry clears obsolete Reflex confirmation evidence on retrigger. Technical review rechecks pending Reflex and BLOCK holds inside the same transaction.
6. Bilingual operator controls clearly separate review-only from billed confirmation. The candidate list contains only authorized same-patient/same-branch invoice lines.
7. MariaDB two-connection concurrency and FK tests; synthetic safety regressions cover mismatched identity, amounts, currency, specimen state and permission gates, plus specialty layouts and critical/release/amendment invariants.

## Boundary
- Clinical approval and activation of actual Reflex thresholds, reference intervals, microbiology methods, analyzer interfaces or other clinical content are not automated by this change.
- Package-billed tests without a dedicated invoice line are not misrepresented as individually invoiced Reflex orders.
- Report history is retained, with releases and amendments managed by existing versioned workflows.
- No real patient, legacy MDB, clinical threshold, production barcode or physical device test can be certified by these synthetic checks.
- Draft PR #128 and #209 remain untouched.

## Software gates
- [ ] Stage 127 safety tests, two-session MariaDB test and migration PASS.
- [ ] All safety/MariaDB suites, TypeScript, ESLint, AR/EN/theme and Next build PASS at feature HEAD.
- [ ] Draft PR reviewed, marked Ready and merged with exact expected HEAD.
- [ ] Independent main CI PASS at merge SHA; owner deploys Hostinger after backup + migrations.

## Stage 132 external sign-off still required
Clinical experts must approve true specialty report presentation, Reflex medical appropriateness, analyzers, QC methods, specimen/barcode, real microbiology, actual printed reports and branch workflows. These are NOT code or CI PASS.