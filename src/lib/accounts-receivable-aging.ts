import { minorToMoney4, money4ToMinor } from "./billing-adjustments.ts";

export type AgingBucket = "CURRENT" | "DAYS_1_30" | "DAYS_31_60" | "DAYS_61_90" | "DAYS_91_PLUS";

function validDateString(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function localCalendarDate(at: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const map = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
    const value = `${map.year}-${map.month}-${map.day}`;
    return validDateString(value) ? value : null;
  } catch {
    return null;
  }
}

export function invoiceDueDateSnapshot(issuedAt: Date, timeZone: string, paymentTermsDays: number) {
  if (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650) return null;
  const localDate = localCalendarDate(issuedAt, timeZone);
  if (!localDate) return null;
  const date = validDateString(localDate);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + paymentTermsDays);
  return date;
}

export function agingBucket(dueDate: string, asOfDate: string): { bucket: AgingBucket; daysOverdue: number } | null {
  const due = validDateString(dueDate);
  const asOf = validDateString(asOfDate);
  if (!due || !asOf) return null;
  const daysOverdue = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
  if (daysOverdue <= 0) return { bucket: "CURRENT", daysOverdue: Math.max(0, daysOverdue) };
  if (daysOverdue <= 30) return { bucket: "DAYS_1_30", daysOverdue };
  if (daysOverdue <= 60) return { bucket: "DAYS_31_60", daysOverdue };
  if (daysOverdue <= 90) return { bucket: "DAYS_61_90", daysOverdue };
  return { bucket: "DAYS_91_PLUS", daysOverdue };
}

export function historicalInvoiceReceivable(input: {
  total: string;
  creditNotes: string;
  payments: string;
  refunds: string;
}) {
  const total = money4ToMinor(input.total);
  const creditNotes = money4ToMinor(input.creditNotes);
  const payments = money4ToMinor(input.payments);
  const refunds = money4ToMinor(input.refunds);
  if ([total, creditNotes, payments, refunds].some(value => value === null)) return null;
  if (total! < BigInt(0) || creditNotes! < BigInt(0) || payments! < BigInt(0) || refunds! < BigInt(0)) return null;

  const rawBalance = total! - creditNotes! - payments! + refunds!;
  return {
    rawBalance: minorToMoney4(rawBalance),
    receivable: minorToMoney4(rawBalance > BigInt(0) ? rawBalance : BigInt(0)),
    creditBalance: minorToMoney4(rawBalance < BigInt(0) ? -rawBalance : BigInt(0)),
  };
}

export function aggregateAging(rows: Array<{
  bucket: AgingBucket;
  receivable: string;
  creditBalance: string;
}>) {
  const totals: Record<AgingBucket, bigint> = {
    CURRENT: BigInt(0),
    DAYS_1_30: BigInt(0),
    DAYS_31_60: BigInt(0),
    DAYS_61_90: BigInt(0),
    DAYS_91_PLUS: BigInt(0),
  };
  let receivableTotal = BigInt(0);
  let creditBalanceTotal = BigInt(0);

  for (const row of rows) {
    const receivable = money4ToMinor(row.receivable);
    const creditBalance = money4ToMinor(row.creditBalance);
    if (receivable === null || creditBalance === null) return null;
    totals[row.bucket] += receivable;
    receivableTotal += receivable;
    creditBalanceTotal += creditBalance;
  }

  return {
    current: minorToMoney4(totals.CURRENT),
    days1to30: minorToMoney4(totals.DAYS_1_30),
    days31to60: minorToMoney4(totals.DAYS_31_60),
    days61to90: minorToMoney4(totals.DAYS_61_90),
    days91plus: minorToMoney4(totals.DAYS_91_PLUS),
    receivableTotal: minorToMoney4(receivableTotal),
    creditBalanceTotal: minorToMoney4(creditBalanceTotal),
  };
}


export function sumMoney4(values: string[]) {
  let total = BigInt(0);
  for (const value of values) {
    const amount = money4ToMinor(value);
    if (amount === null) return null;
    total += amount;
  }
  return minorToMoney4(total);
}
