import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeLiveTariffPrice } from "../src/lib/pricing-exact-money.ts";
import { validPriceDecimal } from "../src/lib/price-import-reconciliation.ts";

function source(path: string) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("live test and package tariffs use the existing exact DECIMAL(18,4) scale", () => {
  for (const [input, expected] of [
    ["0", "0.0000"],
    ["0.0001", "0.0001"],
    ["1", "1.0000"],
    ["1.2", "1.2000"],
    ["123.4567", "123.4567"],
    ["1234567890123.0001", "1234567890123.0001"],
    ["99999999999999.9999", "99999999999999.9999"],
  ]) {
    assert.equal(validPriceDecimal(input), true);
    assert.equal(normalizeLiveTariffPrice(input), expected);
  }
});

test("never round, coerce JSON numbers or admit unrepresentable tariff values", () => {
  for (const value of [
    0, 1.2, 1234567890123.0001, Number.MAX_SAFE_INTEGER, null,
    undefined, {}, [], true, "", " ", "-0", "-1", "+1",
    "1e3", "Infinity", "NaN", ".1", "1.", "1,000", "1 000",
    "01", "00.0001", " 1", "1 ", "1.00000", "0.00001",
    "999999999999999", "999999999999999.9999", "1234567890123.00010",
  ]) {
    assert.equal(normalizeLiveTariffPrice(value), null, "should reject " + String(value));
  }
});

test("both live tariff endpoints use string prices in records AND immutable audits", () => {
  for (const path of [
    "src/app/api/pricing/items/route.ts",
    "src/app/api/pricing/package-items/route.ts",
  ]) {
    const code = source(path);
    assert.match(code, /normalizeLiveTariffPrice\(body\.unitPrice\)/);
    assert.match(code, /amount === null/);
    assert.match(code, /unitPrice: amount,/);
    assert.doesNotMatch(code, /Number\(body\.unitPrice\)|amount\.toFixed\(/);
    assert.match(code, /SELECT id FROM price_lists WHERE id = .* FOR UPDATE/);
    assert.match(code, /planNextPriceRevision/);
    assert.match(code, /SUP(?:ERSEDED|ERSEDED)/);
  }
});

test("pricing UI sends raw FormData strings and validates four decimal places", () => {
  const code = source("src/components/pricing-manager.tsx");
  assert.equal(code.split('unitPrice: form.get("unitPrice")').length - 1, 2);
  assert.doesNotMatch(code, /Number\(form\.get\("unitPrice"\)\)/);
  assert.equal(code.split('name="unitPrice" type="text"').length - 1, 2);
  assert.ok(code.includes('inputMode="decimal"'));
  assert.ok(code.includes("invalid_exact_price"));
  assert.ok(code.includes("maxLength={19}"));
});
