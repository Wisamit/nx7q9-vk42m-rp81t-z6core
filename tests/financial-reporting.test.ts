import test from "node:test";
import assert from "node:assert/strict";
import { aggregateFinancialReport } from "../src/lib/financial-reporting.ts";

test("financial reporting aggregates immutable money snapshots per currency", () => {
  const summaries = aggregateFinancialReport({
    invoices: [
      {
        currency: "AED",
        subtotal: "100.0000",
        discountTotal: "10.0000",
        taxTotal: "4.5000",
        total: "94.5000",
        balanceAmount: "24.5000",
      },
      {
        currency: "USD",
        subtotal: "50.0000",
        discountTotal: "0.0000",
        taxTotal: "0.0000",
        total: "50.0000",
        balanceAmount: "30.0000",
      },
    ],
    paymentAllocations: [
      { currency: "AED", amount: "70.0000" },
      { currency: "USD", amount: "20.0000" },
    ],
    creditNotes: [
      { currency: "AED", amount: "5.0000" },
    ],
    refunds: [
      { currency: "AED", amount: "10.0000" },
    ],
  });

  assert.deepEqual(summaries, [
    {
      currency: "AED",
      gross: "100.0000",
      discounts: "10.0000",
      tax: "4.5000",
      invoiced: "94.5000",
      creditNotes: "5.0000",
      collected: "70.0000",
      refunds: "10.0000",
      netCollected: "60.0000",
      outstandingCurrent: "24.5000",
    },
    {
      currency: "USD",
      gross: "50.0000",
      discounts: "0.0000",
      tax: "0.0000",
      invoiced: "50.0000",
      creditNotes: "0.0000",
      collected: "20.0000",
      refunds: "0.0000",
      netCollected: "20.0000",
      outstandingCurrent: "30.0000",
    },
  ]);
});

test("financial reporting permits negative period cash movement without mixing it into another currency", () => {
  const summaries = aggregateFinancialReport({
    invoices: [],
    paymentAllocations: [],
    creditNotes: [],
    refunds: [
      { currency: "AED", amount: "25.0000" },
      { currency: "USD", amount: "5.0000" },
    ],
  });

  assert.deepEqual(summaries.map(item => [item.currency, item.netCollected]), [
    ["AED", "-25.0000"],
    ["USD", "-5.0000"],
  ]);
});

test("financial reporting fails closed on invalid money or currency data", () => {
  assert.throws(() => aggregateFinancialReport({
    invoices: [{
      currency: "AED",
      subtotal: "10.12345",
      discountTotal: "0.0000",
      taxTotal: "0.0000",
      total: "10.0000",
      balanceAmount: "10.0000",
    }],
    paymentAllocations: [],
    creditNotes: [],
    refunds: [],
  }), /INVALID_FINANCIAL_REPORT_AMOUNT/);

  assert.throws(() => aggregateFinancialReport({
    invoices: [],
    paymentAllocations: [{ currency: "AED-US", amount: "1.0000" }],
    creditNotes: [],
    refunds: [],
  }), /INVALID_FINANCIAL_REPORT_CURRENCY/);
});
