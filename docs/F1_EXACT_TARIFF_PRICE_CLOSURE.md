# F1 — exact live tariff price admission (FIN-001)

**Source baseline:** `fd53477eea4367096eace502ee1df4f7459fdfb3` (F0 user-confirmed Hostinger deploy, independent main CI #1827 success).

## Previously verified P1

The web pricing form and both API routes used JavaScript `Number()`; the APIs then persisted `amount.toFixed(4)`. Money submitted as `1234567890123.0001` can silently lose its last ten-thousandth through binary floating-point conversion, creating wrong master tariffs and wrong audit snapshots.

## Exact contract

- Both UI forms submit **literal string** `FormData.get("unitPrice")`, never numeric JSON.
- Server uses `normalizeLiveTariffPrice` aligned with existing `validPriceDecimal` import admission. Only JSON strings matching a nonnegative canonical decimal with up to **14 integer digits and four fractional digits** are allowed, as enforced by the Prisma `DECIMAL(18,4)` columns.
- Reject numbers, NaN, exponent syntax, signs, commas, whitespace, leading zeros, extra scale and overflow. No scientific notation, silent rounding or padding a value truncated by a JSON float; failed payloads return HTTP 400 `invalid_exact_price`.
- Accepted strings are right-padded to **exactly four places** without any floating-point operations. The *same* normalized string is written into database `unitPrice` and immutable audit `newValues.unitPrice`; the existing currency comes from the persisted price list, not a user-supplied currency.
- The existing `planNextPriceRevision`, `FOR UPDATE` list lock, branch-scope check, original predecessor history and audit action IDs are retained. No backdated overwrite or released order/invoice rewrite.
- Forms use a bounded text+decimal-keyboard input with the server-compatible exact pattern, 19-char max, AR/EN validation guidance. No change to general calculator or clinical-result numeric contracts.
- **No schema migration**: existing financial columns already use correct fixed precision.

## Reproducible gates

```sh
npm ci
npm run test:safety
node --experimental-strip-types --test tests/f1-exact-tariff-mariadb.integration.test.ts
npx tsc --noEmit
npm run lint
npx next build
```

`tests/f1-exact-tariff-safety.test.ts` covers accepted literal 0, 4-place fractions and 14-digit maxima, rejects float and precision-truncation cases and asserts **both** APIs and UI are wired. `tests/f1-exact-tariff-mariadb.integration.test.ts` validates an independently inserted synthetic test tariff `1234567890123.0001`, preserves its previous `10.1200` revision across effective-date closure and serializes against a competing price-list lock; it also inserts/reads the maximum package tariff `99999999999999.9999`. Integrated code/identity/clinical paths remain covered by the existing full CI.

## Limits and acceptance

CI/regressions exercise the helper, route wiring, actual MariaDB `DECIMAL` storage and revision-lock semantics. They do **not** authorize financial ledger, tax law, discounts or currency rounding rules (§86; phase F4), which remain professionally approval-dependent. They are not evidence of owner browser signoff or clinical GO; F7/F8 remain deferred. Tests use only isolated synthetic database rows. F1 release requires exact HEAD green PR CI, independent merged-main CI, and **owner verification of exact Hostinger deploy SHA**. Do not start F2 before this deployment checkpoint is complete.
