import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aggregateFinancialReport } from "../src/lib/financial-reporting.ts";
import { addCurrencyAmount, cappedDatasetNames, comparableMargin, financialText, moneyText } from "../src/lib/analytics-integrity.ts";

const source = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("analytics money is exact at 4 decimal places even beyond Number.MAX_SAFE_INTEGER", () => {
  const amounts = new Map<string, bigint>();
  addCurrencyAmount(amounts, "EGP", "99999999999999.9999");
  addCurrencyAmount(amounts, "EGP", "0.0001");
  addCurrencyAmount(amounts, "USD", "5.5678");
  assert.equal(moneyText(amounts.get("EGP")!, "EGP"), "EGP 100,000,000,000,000.00");
  assert.equal(moneyText(amounts.get("USD")!, "USD"), "USD 5.5678");
  assert.equal(financialText("-0.0001", "EGP"), "EGP -0.0001");
  assert.throws(() => addCurrencyAmount(amounts, "EGP", "1.12345"), /INVALID_ANALYTICS_AMOUNT/);
});

test("financial management summary distinguishes invoice totals, dated refunds and current outstanding", () => {
  const rows = aggregateFinancialReport({
    invoices: [
      {currency:"EGP",subtotal:"125.3333",discountTotal:"5.1111",taxTotal:"0.0000",total:"120.2222",balanceAmount:"20.2222"},
      {currency:"USD",subtotal:"30.0000",discountTotal:"0.0000",taxTotal:"0.0000",total:"30.0000",balanceAmount:"0.0000"},
    ],
    paymentAllocations:[{currency:"EGP",amount:"105.0000"}],
    refunds:[{currency:"EGP",amount:"5.0001"}],
    creditNotes:[{currency:"EGP",amount:"10.0000"}],
  });
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0],{
    currency:"EGP",gross:"125.3333",discounts:"5.1111",tax:"0.0000",
    invoiced:"120.2222",creditNotes:"10.0000",collected:"105.0000",
    refunds:"5.0001",netCollected:"99.9999",outstandingCurrent:"20.2222",
  });
  assert.equal(rows[1].currency,"USD");
  assert.equal(rows[1].collected,"0.0000");
});

test("profit margins stay suppressed with partial, mutable-lot or multi-currency attribution", () => {
  const revenue=new Map([["EGP",120000n]]);
  const cost=new Map([["EGP",20000n]]);
  assert.deepEqual([...comparableMargin({revenue,cost,totalItems:2,coveredItems:1,indicativeCostItems:0})],[]);
  assert.deepEqual([...comparableMargin({revenue,cost,totalItems:2,coveredItems:2,indicativeCostItems:1})],[]);
  assert.deepEqual([...comparableMargin({revenue,cost:new Map([["USD",20000n]]),totalItems:2,coveredItems:2,indicativeCostItems:0})],[]);
  assert.deepEqual([...comparableMargin({revenue,cost,totalItems:2,coveredItems:2,indicativeCostItems:0})],[["EGP",100000n]]);
});

test("never silently publish bounded partial management totals", () => {
  assert.deepEqual(cappedDatasetNames({invoices:2,orders:5},{invoices:2,orders:3}),["invoices"]);
  assert.deepEqual(cappedDatasetNames({invoices:2,orders:5},{invoices:1,orders:4}),[]);
  const page=source("../src/app/analytics/page.tsx");
  assert.ok(page.includes("cappedDatasetNames"));
  assert.ok(page.includes("No totals are shown because at least one dataset may be incomplete."));
  assert.ok(page.indexOf("const truncatedCollections") < page.indexOf("const financeByCurrency"));
});

test("analytics use organization and authorized branches and hide staff finance without billing permission", () => {
  const page=source("../src/app/analytics/page.tsx");
  const dash=source("../src/app/dashboard/page.tsx");
  assert.ok(page.includes('requirePermission("analytics.view")'));
  assert.ok(page.includes('permissionSet(session).has("billing.view")'));
  assert.equal((page.match(/canViewFinancial \? prisma\./g) || []).length, 4);
  assert.ok(page.includes('{canViewFinancial && <section className="detail-section">'));
  assert.ok(page.includes('{canViewFinancial && <section className="table-card detail-section">'));
  assert.ok(page.includes('{canViewFinancial && <th>{tr(locale, "Ordered value"'));

  assert.ok(page.includes("authorizedBranchIds.includes(requestedBranchId)"));
  assert.ok(page.includes("orderingBranchId: { in: branchIds }"));
  assert.ok(page.includes("aggregateFinancialReport"));
  assert.ok(page.includes("indicativeCostItems.add"));
  assert.ok(page.includes("current outstanding is not a historical period-end balance"));
  assert.ok(dash.includes('branchId && permissions.has("billing.view") ? prisma.invoice.findMany'));
  assert.ok(dash.includes('{permissions.has("billing.view") && <aside'));
});
