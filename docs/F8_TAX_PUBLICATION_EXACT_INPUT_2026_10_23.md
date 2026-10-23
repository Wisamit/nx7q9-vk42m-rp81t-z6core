# F8 §86 — Tax publication exact-input admission (2026-10-23)

Baseline: verified `main=bd29804e1e9aa8b486f1b7eb5185a7cd5953d9f5` after merged PR #379; independent main push CI #39998902027 COMPLETED SUCCESS 225/225. Full 88-section `02_MASTER_SCOPE.md` scope retained.

## Confirmed software integrity defect

`src/app/api/billing/tax-rules/route.ts` historically used `text(value,max) => value.trim().slice(0,max)` for legally significant configuration inputs including 36-character branch/service identity, 10-character effective date, 60-character tax rule code, 200-character bilingual name and 1000-character decision reason. A longer request could silently become a DIFFERENT tax policy, scope or date before validation, for example `2026-10-23extra` becoming `2026-10-23`. Neither audit nor user confirmation recorded the discarded suffix.

## Implemented finite software correction

- Add small pure `parseExactTaxPublicationInput` with exact original maximum lengths, full UUID scope/service admission and full ISO local effective-day validation. Reject overlong/ambiguous IDs, impossible calendar dates, truncated labels, reasons or fiscal day, instead of clipping input.
- Continue accepted explicit organization-wide defaults (omitted/null/empty `branchId`) and case normalization of valid user-supplied tax codes. Retain bilingual names, explicit effective date, tested treatment and mode, and independent current permission/scope checks.
- Reject JSON numeric tax rates for this financial policy publication path; require an exact decimal rate string and preserve `validTaxRate`, `taxLineAmounts` and `DECIMAL(5,2)` admission. This is about precision and consent, not choosing a jurisdiction's percentage.
- Keep version-only insertion, effective dating, `taxConfigVersion` branch lock, unique effective scope/revision and `TAX_RULE_PUBLISHED` audit, without deleting or changing historical invoice/tax-rule rows.
- Add regression for overlong hidden branch/service suffix, invalid leap dates, Arabic length, long audit reason, exact positive/zero-rate shape, numerical coercion, and source-level continued authorization/versioning.

## Remaining gate (DO NOT WAIVE)

This corrects one §86 SOFTWARE admission defect; it does NOT approve a jurisdiction, AED/VAT treatment, currency conversion, exemption, refund law or an accountant policy. Owner + qualified accountant must sign explicit effective policies before operational tax use: `BLOCKED_EXTERNAL`.

§75 signed analyzer/sample-interference clinical policy, §87 complete approved field-level activation, and §88 original MDB row-level provenance and expert mapping remain open. F7 protected browser UAT 0/486 and F8 real-world qualified UAT 0/88, seven independent signoffs missing: `NO_GO`. No Hostinger-deployed SHA, hardware commissioning or restore signoff inferred.

Merge gate: complete CI SUCCESS on exact PR HEAD; compare branch/PR/CI SHA; merge with `expected_head_sha`; independent main push CI SUCCESS on exact merged SHA. No manual user testing during remaining implementation.
