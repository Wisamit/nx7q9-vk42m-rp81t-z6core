import { minorToMoney4, money4ToMinor } from "./billing-adjustments.ts";

export type ClientLedgerEvent = {
  sourceId: string;
  sourceNumber: string;
  branchId: string;
  branchCode: string;
  occurredAt: Date;
  lineType: "INVOICE" | "CREDIT_NOTE" | "PAYMENT" | "REFUND";
  description: string;
  amount: string;
};

export function nextDateString(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function localParts(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const map = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

export function localDateStartUtc(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const target = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
  const validity = new Date(Date.UTC(target.year, target.month - 1, target.day));
  if (validity.toISOString().slice(0, 10) !== value) return null;

  let guess = Date.UTC(target.year, target.month - 1, target.day, 0, 0, 0);
  try {
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const observed = localParts(new Date(guess), timeZone);
      const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
      const desiredAsUtc = Date.UTC(target.year, target.month - 1, target.day, 0, 0, 0);
      const delta = desiredAsUtc - observedAsUtc;
      if (delta === 0) break;
      guess += delta;
    }
    const finalParts = localParts(new Date(guess), timeZone);
    if (finalParts.year !== target.year || finalParts.month !== target.month || finalParts.day !== target.day || finalParts.hour !== 0 || finalParts.minute !== 0) {
      return null;
    }
    return new Date(guess);
  } catch {
    return null;
  }
}

function signedMinor(event: ClientLedgerEvent) {
  const amount = money4ToMinor(event.amount);
  if (amount === null || amount < BigInt(0)) return null;
  return event.lineType === "INVOICE" || event.lineType === "REFUND" ? amount : -amount;
}

export function buildClientStatementLedger(input: {
  openingEvents: ClientLedgerEvent[];
  periodEvents: ClientLedgerEvent[];
}) {
  let opening = BigInt(0);
  for (const event of input.openingEvents) {
    const signed = signedMinor(event);
    if (signed === null) return null;
    opening += signed;
  }

  let running = opening;
  let charges = BigInt(0);
  let credits = BigInt(0);
  let payments = BigInt(0);
  let refunds = BigInt(0);

  const lines = [...input.periodEvents]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || a.sourceNumber.localeCompare(b.sourceNumber))
    .map(event => {
      const amount = money4ToMinor(event.amount);
      const signed = signedMinor(event);
      if (amount === null || signed === null) throw new Error("INVALID_LEDGER_AMOUNT");
      if (event.lineType === "INVOICE") charges += amount;
      else if (event.lineType === "CREDIT_NOTE") credits += amount;
      else if (event.lineType === "PAYMENT") payments += amount;
      else refunds += amount;
      running += signed;
      return {
        ...event,
        debitAmount: event.lineType === "INVOICE" || event.lineType === "REFUND" ? minorToMoney4(amount) : "0.0000",
        creditAmount: event.lineType === "CREDIT_NOTE" || event.lineType === "PAYMENT" ? minorToMoney4(amount) : "0.0000",
        runningBalance: minorToMoney4(running),
      };
    });

  return {
    openingBalance: minorToMoney4(opening),
    invoiceCharges: minorToMoney4(charges),
    creditNotes: minorToMoney4(credits),
    payments: minorToMoney4(payments),
    refunds: minorToMoney4(refunds),
    closingBalance: minorToMoney4(running),
    lines,
  };
}

export function clientPaymentAllocationError(input: {
  paymentAmount: string;
  allocations: Array<{ amount: string; invoiceBalance: string }>;
}) {
  const paymentAmount = money4ToMinor(input.paymentAmount);
  if (paymentAmount === null || paymentAmount <= BigInt(0) || input.allocations.length === 0) return "invalid_amount";
  let allocated = BigInt(0);
  for (const allocation of input.allocations) {
    const amount = money4ToMinor(allocation.amount);
    const balance = money4ToMinor(allocation.invoiceBalance);
    if (amount === null || balance === null || amount <= BigInt(0)) return "invalid_allocation";
    if (amount > balance) return "allocation_exceeds_invoice_balance";
    allocated += amount;
  }
  if (allocated !== paymentAmount) return "allocation_total_mismatch";
  return null;
}
