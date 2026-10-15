import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { minorToMoney4, money4ToMinor } from "./billing-adjustments.ts";
import { normalizedPaymentMethodCode } from "./payment-methods.ts";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type PaymentPostingRequest = {
  kind: "INVOICE" | "CLIENT_ACCOUNT";
  organizationId: string;
  actorUserId: string;
  branchId?: string;
  clientId?: string;
  currency?: string;
  paymentMethodId: string;
  legacyMethod: string;
  reference: string;
  amount: string;
  allocations: Array<{ invoiceId: string; amount: string }>;
};

export function paymentPostingKey(value: unknown): string | null {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    return null;
  }
  return value.toLowerCase();
}

function canonicalMoney(value: string): string {
  const minor = money4ToMinor(value);
  return minor === null ? value : minorToMoney4(minor);
}

export function paymentPostingFingerprint(input: PaymentPostingRequest): string {
  const stable = [
    "FAMILY_LAB_PAYMENT_POSTING_V1", input.kind,
    input.organizationId, input.actorUserId,
    input.branchId || "", input.clientId || "", input.currency || "",
    input.paymentMethodId, normalizedPaymentMethodCode(input.legacyMethod),
    input.reference.trim(), canonicalMoney(input.amount),
    input.allocations.map(row => [row.invoiceId, canonicalMoney(row.amount)])
      .sort((a, b) => a[0].localeCompare(b[0])),
  ];
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export async function lookupPaymentPosting(db: DbClient, organizationId: string,
  postingKey: string, fingerprint: string) {
  const existing = await db.payment.findFirst({
    where: { organizationId, postingKey },
    select: { postingFingerprint: true, postingResponseSnapshot: true },
  });
  if (!existing) return null;
  const response = existing.postingResponseSnapshot;
  if (existing.postingFingerprint !== fingerprint || !response || 
      typeof response !== "object" || Array.isArray(response) ||
      (response as { status?: unknown }).status !== "ok") {
    return { kind: "conflict" as const };
  }
  return { kind: "replay" as const, response };
}
