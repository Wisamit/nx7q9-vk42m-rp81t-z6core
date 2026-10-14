# Stage 121 — Exact Reflex and Delta Clinical Rule Decimal Limits

## Source of change / no duplicated features
- Latest base: `main` at `d5a8e2c9bca2171733790843ba155242847f4421` (Stage 120 merged; main CI #1262 SUCCESS and owner-confirmed Hostinger deployment).
- Master Scope §10 Reflex, §38–40 Result Validation / Autoverification, §75 Rules Engine, §§79–80 Audit/Historical Integrity.
- Existing Reflex rule creation, Delta rule creation/evaluation, seven-class clinical rule governance and high-risk one-time step-up remain in place. This stage fixes **only** precision loss during rule draft creation and the corresponding audit representation.
- Verified code gap: `src/app/api/clinical-rules/reflex/route.ts` converted `body.numericThreshold` through `Number(...).toFixed(8)`; `src/app/api/clinical-rules/delta/route.ts` similarly converted `absoluteLimit` to 8 decimals and `percentLimit` to 6. Number uses binary floating point and `toFixed` silently rounds; this may alter a clinical trigger or diagnostic change boundary without explicit acceptance.

## Implementation
1. `src/lib/clinical-rule-decimal.ts`: strict, column-aware decimal parser that **accepts strings only**, rejects scientific notation, unsafe JSON number literals, overflow, nonfinite values, comma-separated values, negative Delta bounds and excess fractional digits; preserves canonical fixed-scale exact text. Optional omitted fields return `null`. No Float/Number intermediates.
2. Reflex thresholds are validated against `@db.Decimal(24,8)`. Signed negative limits are allowed for analytes where clinically configured. Exact canonical text is saved in the draft and written in the audit payload. Numeric operator suitability remains server-validated. No automatic rule approval or added reflex tests.
3. Delta absolute limits are validated as nonnegative `@db.Decimal(24,8)`, Delta percentage as nonnegative `@db.Decimal(18,6)`. Existing lookback/method/branch/component constraints remain unchanged. Exact text is stored and audited; all rules remain inactive drafts until separately approved.
4. Safety test `tests/stage-121-exact-clinical-decimal-safety.test.ts` checks boundaries, negative zero, fractions, overflow, scientific notation, numbers mistakenly transmitted as JSON numbers, and code/schema linkage.
5. Real MariaDB test `tests/stage-121-exact-clinical-decimal-mariadb.integration.test.ts` stores synthetic inactive Reflex/Delta rules, checks persisted SQL DECIMAL values including negative microthresholds and percentage micro-limits, SQL comparisons, and exact recorded audit strings. Wired into full CI.
6. No Prisma schema changes, migrations, patient/clinical result writes, invoice/pricing changes, instrument actions, or automatic activation. No data migration of existing historical rule settings — historical records remain intact.

## Critical safety boundaries and deferred acceptance
- Do not silently correct or round already-accepted old rule limits. A separate clinically governed draft/version approval is required for corrections to configured historical values.
- Code tests prove exact decimal persistence, not that a chosen threshold has clinical validity; clinical specialists approve rules after development.
- End-of-development medical/manual/analyzer/device/UAT and backup recovery tests are deferred as agreed; do not certify them now.
- Existing Draft PR #128 and #209 remain unchanged; no Vercel, only owner Hostinger deployment after independent main CI SUCCESS.

## Final release gates
- [ ] Feature HEAD: Safety, MariaDB, TypeScript, ESLint, AR/EN and Next build CI SUCCESS
- [ ] Draft PR → Ready → expected_head_sha merge
- [ ] Independent main CI SUCCESS on exact merge SHA
- [ ] Owner confirmed Hostinger deployment
