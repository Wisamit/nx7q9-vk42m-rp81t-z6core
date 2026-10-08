import { minorToMoney4, money4ToMinor } from "@/lib/billing-adjustments";

export type FinancialReportInvoiceRow = {
  currency: string;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  balanceAmount: string;
};

export type FinancialReportMoneyRow = {
  currency: string;
  amount: string;
};

export type FinancialReportCurrencySummary = {
  currency: string;
  gross: string;
  discounts: string;
  tax: string;
  invoiced: string;
  creditNotes: string;
  collected: string;
  refunds: string;
  netCollected: string;
  outstandingCurrent: string;
};

type Totals = {
  gross: bigint;
  discounts: bigint;
  tax: bigint;
  invoiced: bigint;
  creditNotes: bigint;
  collected: bigint;
  refunds: bigint;
  outstandingCurrent: bigint;
};

function zeroTotals(): Totals {
  return {
    gross: BigInt(0),
    discounts: BigInt(0),
    tax: BigInt(0),
    invoiced: BigInt(0),
    creditNotes: BigInt(0),
    collected: BigInt(0),
    refunds: BigInt(0),
    outstandingCurrent: BigInt(0),
  };
}

function amount(value: string) {
  const parsed = money4ToMinor(value);
  if (parsed === null || parsed < BigInt(0)) throw new Error("INVALID_FINANCIAL_REPORT_AMOUNT");
  return parsed;
}

function normalizedCurrency(value: string) {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("INVALID_FINANCIAL_REPORT_CURRENCY");
  return currency;
}

function rowFor(map: Map<string, Totals>, currency: string) {
  const normalized = normalizedCurrency(currency);
  const row = map.get(normalized) || zeroTotals();
  map.set(normalized, row);
  return row;
}

export function aggregateFinancialReport(input: {
  invoices: FinancialReportInvoiceRow[];
  paymentAllocations: FinancialReportMoneyRow[];
  creditNotes: FinancialReportMoneyRow[];
  refunds: FinancialReportMoneyRow[];
}): FinancialReportCurrencySummary[] {
  const totals = new Map<string, Totals>();

  for (const invoice of input.invoices) {
    const row = rowFor(totals, invoice.currency);
    row.gross += amount(invoice.subtotal);
    row.discounts += amount(invoice.discountTotal);
    row.tax += amount(invoice.taxTotal);
    row.invoiced += amount(invoice.total);
    row.outstandingCurrent += amount(invoice.balanceAmount);
  }

  for (const credit of input.creditNotes) {
    rowFor(totals, credit.currency).creditNotes += amount(credit.amount);
  }

  for (const allocation of input.paymentAllocations) {
    rowFor(totals, allocation.currency).collected += amount(allocation.amount);
  }

  for (const refund of input.refunds) {
    rowFor(totals, refund.currency).refunds += amount(refund.amount);
  }

  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, row]) => ({
      currency,
      gross: minorToMoney4(row.gross),
      discounts: minorToMoney4(row.discounts),
      tax: minorToMoney4(row.tax),
      invoiced: minorToMoney4(row.invoiced),
      creditNotes: minorToMoney4(row.creditNotes),
      collected: minorToMoney4(row.collected),
      refunds: minorToMoney4(row.refunds),
      netCollected: minorToMoney4(row.collected - row.refunds),
      outstandingCurrent: minorToMoney4(row.outstandingCurrent),
    }));
}
