export type BillingInvoiceStatus = "ISSUED" | "PARTIALLY_PAID" | "PAID" | "CREDITED";

const MONEY4 = /^\d+(?:\.\d{1,4})?$/;

export function money4ToMinor(value: string): bigint | null {
  const normalized = value.trim();
  if (!MONEY4.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  return BigInt(whole) * BigInt(10000) + BigInt((fraction + "0000").slice(0, 4));
}

export function minorToMoney4(value: bigint) {
  const sign = value < BigInt(0) ? "-" : "";
  const absolute = value < BigInt(0) ? -value : value;
  const whole = absolute / BigInt(10000);
  const fraction = (absolute % BigInt(10000)).toString().padStart(4, "0");
  return `${sign}${whole}.${fraction}`;
}

export function invoiceAdjustmentState(input: {
  total: string;
  credited: string;
  netPaid: string;
}) {
  const total = money4ToMinor(input.total);
  const credited = money4ToMinor(input.credited);
  const netPaid = money4ToMinor(input.netPaid);
  if (total === null || credited === null || netPaid === null || credited > total) return null;

  const obligation = total - credited;
  const balance = obligation > netPaid ? obligation - netPaid : BigInt(0);
  const overpayment = netPaid > obligation ? netPaid - obligation : BigInt(0);
  const status: BillingInvoiceStatus =
    credited === total
      ? "CREDITED"
      : balance === BigInt(0)
        ? "PAID"
        : netPaid > BigInt(0)
          ? "PARTIALLY_PAID"
          : "ISSUED";

  return {
    status,
    balance: minorToMoney4(balance),
    overpayment: minorToMoney4(overpayment),
    obligation: minorToMoney4(obligation),
  };
}

export function creditNoteError(input: {
  invoiceStatus: string;
  total: string;
  credited: string;
  requested: string;
}) {
  if (!["ISSUED", "PARTIALLY_PAID", "PAID"].includes(input.invoiceStatus)) return "invoice_not_creditable";
  const total = money4ToMinor(input.total);
  const credited = money4ToMinor(input.credited);
  const requested = money4ToMinor(input.requested);
  if (total === null || credited === null || requested === null || requested <= BigInt(0)) return "invalid_amount";
  const remaining = total - credited;
  if (remaining <= BigInt(0)) return "invoice_fully_credited";
  if (requested > remaining) return "credit_exceeds_remaining_amount";
  return null;
}

export function refundError(input: {
  paymentStatus: string;
  allocated: string;
  refundedForAllocation: string;
  requested: string;
}) {
  if (input.paymentStatus !== "POSTED") return "payment_not_refundable";
  const allocated = money4ToMinor(input.allocated);
  const refunded = money4ToMinor(input.refundedForAllocation);
  const requested = money4ToMinor(input.requested);
  if (allocated === null || refunded === null || requested === null || requested <= BigInt(0)) return "invalid_amount";
  const remaining = allocated - refunded;
  if (remaining <= BigInt(0)) return "payment_allocation_fully_refunded";
  if (requested > remaining) return "refund_exceeds_allocation";
  return null;
}
