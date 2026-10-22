# F4 — Clinical interference and financial/tax policy closure

## Status
F4 remains **IN_PROGRESS**. This branch is a concrete fail-closed safety increment on top of the merged F3 `main` commit. It does **not** assert real analyzer-vendor, jurisdictional accounting, regulatory or professional acceptance.

## Existing repository surfaces — reuse, do not recreate

| Domain | Existing implementation | F4 incremental change | Remaining engineering / external gate |
| --- | --- | --- | --- |
| Analyzer import | `src/app/api/analyzers/imports/commit/route.ts`, authenticated mapping, specimen custody, QC gating, effective reference intervals, delta and validation holds | An analyzer-derived `UNKNOWN` LIS result flag must not pass autoverification even if a legacy policy disables `requireAllFlagsNormal`; retain technical review | Instrument HIL/interference raw flags and vendor meanings are not established as uniform structured import evidence; do not treat missing vendor policy as clearance |
| Rule-based clinical validation | `src/lib/validation-holds.ts`, governed hold-rule APIs, result validation | Unknown configured condition and malformed `RESULT_SOURCE` selection hold for manual review, not silent `ANY_ABNORMAL` fallback | Signed interference-specific rules, validated cross-device flag normalization, method/test/branch scoped effective policy and deliberate signoff require qualified configuration |
| Tax rules | `src/app/api/billing/tax-rules/route.ts`, organization/branch/service scoped TaxRule, effective date, audit | `src/lib/tax-policy.ts` rejects invalid runtime treatment/price mode and over-precision/overflow amounts before financial persistence | Tax applicability, exemptions, rounding and currency-specific regulations remain configurable, not guessed |
| Credit reversals | `taxCreditReversal` and existing invoice/credit snapshot workflow | Reject prior credited tax greater than credited gross and amounts exceeding DECIMAL(18,4) | Formal accountant/owner reconciliation and provider settlement acceptance are F8 external evidence |
| Currencies / organization | Existing organization and branch default currencies, explicit invoice currencies | No new currency conversion or automatic tax jurisdiction inferred | Rates, legal definitions, contracts, exchange rounding, jurisdiction and real ledgers require approved real-world policy |

## Engineering safety expectations

- Missing or unknown analyzer data **never proves instrument interference absent**. The new UNKNOWN-result guard is *necessary but not sufficient* for HIL/vendor interference approval.
- If an unresolved hold applies, the result is subject to authorized manual technical/medical review, not a fabricated negative finding or automatic clinical release.
- Never hard-code hemolysis/icterus/lipemia limits, Westgard cutoffs, tax rates, company country or currency. F4 must eventually provide the effective-dated/approved policy binding needed for any automated decision.
- Preserve tenant/branch permissions, signed audit, raw analyzer messages, historical financial snapshots, DECIMAL precision and released-report immutability.
- Existing F3 HMAC synthetic source work and F2 ten-class master revisions are retained. No migrations or real clinical/financial master writes in this increment.
- `tests/f4-analyzer-policy-unknown-failclosed.test.ts` and `tests/f4-tax-policy-failclosed.test.ts` are safety regressions. Green CI is necessary; it does not prove real analyzer/clinical/finance go-live.
- Owner's manual browser UAT remains F7; qualified clinical/finance/vendor/DR go/no-go remains F8.

## F4 remaining code closure

Instrument interference requires a typed, bounded per-observation raw-flag evidence contract, an authorized vendor-specific mapping with effective dates/reviewers, and import/autoverification fail-closed integration with negative and MariaDB checks. Existing TaxRule support must be compared against real jurisdiction/contract configuration needs when policies become available; until then retain documented external blockers rather than inventing tax values.

This F4 incremental PR must **remain Draft** until the above software gap is closed or explicitly classified in the finite #327 completion board. Do not call the entire F4 phase finished based on these guards.


## F4 bridge fail-closed increment — HL7 and ASTM

The existing isolated `bridge/protocols.mjs` normalizes only a conservative
HL7 ORU^R01 and ASTM E1394 subset. Its original implementation did **not**
parse or carry forward these fields: HL7 OBX-8 abnormal/interference flag,
OBX-11 observation status, HL7 NTE free-text comments, or ASTM R-record
trailing clinical qualifiers. Silently dropping them while producing a
normal-looking staged observation is unsafe.

This branch changes the parser to **reject unapproved messages before
normalization or LIS ingestion** when:
- HL7 OBX-8 contains *any* value, including apparently normal or vendor
  interference codes; no code has been classified as safe by assumption;
- HL7 OBX-11 explicitly represents a non-final status (including correction
  or preliminary); a correction must use qualified amendment handling;
- HL7 NTE-3 onwards contains clinical comments/caveats; and
- ASTM R records have nonempty trailing reference/abnormal/status/context
  fields beyond the approved code, value and unit profile.

This is a conservative input contract, not validated live analyzer
commissioning or a substitute for proper HIL threshold/version policy.
The bridge still retains/quarantines original raw payload through its
existing machinery. Future vendor integration requires an independently
approved analyzer/assay/branch effective-dated mapping that preserves
the flags and applies review/hold rules; it must not globally whitelist
HL7 abnormal flags or guess thresholds. Synthetic regression:
`tests/f4-analyzer-interference-bridge.test.mjs`, explicitly called from CI.

**Known limitation**: A vendor can encode interference indicators in other
fields or proprietary segments. Lack of an OBX-8/R flag does not prove
interference absent; a vendor-specific approved policy remains required
for qualified autoverification at F8. Do not activate clinical GO.
