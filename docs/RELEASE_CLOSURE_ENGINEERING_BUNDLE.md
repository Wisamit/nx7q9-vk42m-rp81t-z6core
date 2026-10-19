# Family Lab — combined release-closure engineering bundle

**Frozen deployed baseline:** `354fd1d9203745ef5926c9e769101065601e01ab` on Hostinger, confirmed by owner. **This package is NOT a new feature Stage and is not deployed until a separate Hostinger confirmation.**

## Strict intent
A single coherent closure package, not a new endless sequence of numbered increments. Master Scope §§1–88 remain unchanged. Only fix observed defects and strengthen evidence of existing functionality. Retain source-level tests and clinical/financial audit; prohibit release or production GO solely on GitHub CI.

## Source-confirmed fixes

1. **Clinical UI preserved deliberately:** the previous source audit flagged the AST susceptibility form as a potential inline form. Existing regression contract requires it to remain a multi-row clinical workspace until qualified clinical/owner signoff. The initially considered compact conversion was deliberately **reverted**; no unapproved behavior/layout alteration remains. Culture/observation/isolate CRUD continue using their existing accessible modals. The 81-route browser and clinical workflow review remains OPEN, not silently skipped.
2. **Send-out laboratory cost exactness** (`src/app/api/send-outs/route.ts`): prior cost parsing used `Number(costText)` then `toFixed(4)`, allowing binary floating-point rounding and implicit truncation. Use a validated decimal lexeme with at most 14 integer/4 fractional digits matching `DECIMAL(18,4)`; reject negative, excess precision, scientific notation, invalid currency, cost-without-currency or currency-without-cost. Construct `Prisma.Decimal` directly for writes, preserve explicit currency and exact audit snapshot. No migration and no existing stored amount rewritten.

3. **Concurrent send-out uniqueness** (\`src/app/api/send-outs/route.ts\`): the old active-referral search happened outside the create transaction, so independent submissions for the same order item could both observe no existing active referral. A per-order-item InnoDB \`FOR UPDATE\` row lock now precedes a fresh transaction-scoped active-referral query and every specimen/custody/referral/audit write. Distinct order items remain concurrently usable. A real two-connection MariaDB test verifies lock contention, newly committed referral visibility, and exact persisted DECIMAL cost. This avoids imposing a global tenant-wide lock and does not change historical referrals.

## Broad reusable closure/test consolidation

4. **Actual 88-scope/81-route structural linkage** (`scripts/release-closure-evidence.mjs`): parse the historical Stage131 88-section matrix, verify all source anchors exist, compare all source pages against the canonical 81-route manifest, record historical classifications, expose five source rows without direct section-specific tests, and pull the complete existing static UI graph. Automatically enumerate unresolved §75/86/87/88; never turn old matrix categories into runtime acceptance. The historical Stage132 88-case UAT register remains NOT_EXECUTED, its old release SHA is reported, and the tool refuses `--require-production-go`. Machine- and human-readable evidence is published as a CI artifact on every branch/main run.
5. **Regression and unchanged boundaries**: exact financial parsing, discount fingerprint sensitivity to branch, tariff and tax, formula/parser safety source, branch-scoped global search, effective-dated report template selection, susceptibility dialog lifecycle, 88/81 integrity, no fake human UAT, plus the existing full safety and MariaDB cross-module suites including Stage130, Prisma, TS, lint, AR/EN/RTL/theme, and Next.js production build.

## Explicit outstanding work — not fictitiously completed

- §75 requires qualified analyzer-specific interference/clinical policy; no medical thresholds guessed.
- §86 requires locally approved tax/currency/accounting policy.
- §87 spreadsheet/bundle field-level roundtrip and approved activation remains incomplete; review-only Excel/CSV files must not be treated as live imports.
- §88 private original MDB field/row reconciliation and medical/financial master approval are not performed by GitHub CI.
- Issue #265: static scan covers all 81 routes, **actual synthetic browser and role/branch visual screenshots are NOT_EXECUTED**. Clinical/identity-sensitive full-page inline forms require explicit product/clinical/security resolution rather than unsafe blanket conversion. Current static issue count and exceptions are published by the evidence generator; a screenshot is not a clinical acceptance result.
- Issue #250: all 88 qualified field UAT cases and seven clinical/finance/device/security/provider/DR/owner approvals remain unsigned/NOT_EXECUTED. A Hostinger deployment success is not a verified encrypted offsite restore or analyzer validation.

## End-of-coding acceptance rule
No new optional features, no fake percent complete, no forced clinical or billing policies. Only source-confirmed P0/P1 defects plus the pre-agreed all-route UI completion work; each has a reproducing test and remains fixed after branch CI success + independent main CI success. The comprehensive browser review and real professional UAT gates stay open until genuine evidence, not until a numbered Stage threshold.
