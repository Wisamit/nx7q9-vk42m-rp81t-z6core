import type { Prisma, PrismaClient } from "../../generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type SettlementBaseMethod = "CASH" | "CARD" | "BANK_TRANSFER" | "ONLINE" | "OTHER";

export type SettlementPaymentMethod = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  baseMethod: SettlementBaseMethod;
  requiresReference: boolean;
};

const SETTLEMENT_BASE_METHODS = new Set<SettlementBaseMethod>([
  "CASH",
  "CARD",
  "BANK_TRANSFER",
  "ONLINE",
  "OTHER",
]);

export function normalizedPaymentMethodCode(value: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60)
    : "";
}

export function paymentMethodIsSettlement(input: {
  status: "ACTIVE" | "INACTIVE";
  isSettlement: boolean;
  baseMethod: string;
}) {
  return input.status === "ACTIVE"
    && input.isSettlement
    && SETTLEMENT_BASE_METHODS.has(input.baseMethod as SettlementBaseMethod);
}

export async function resolveSettlementPaymentMethod(
  db: DbClient,
  input: {
    organizationId: string;
    paymentMethodId?: string | null;
    legacyMethod?: string | null;
  },
): Promise<SettlementPaymentMethod | null> {
  const id = input.paymentMethodId?.trim() || "";
  const legacyCode = normalizedPaymentMethodCode(input.legacyMethod);
  if (!id && !legacyCode) return null;

  const config = await db.paymentMethodConfig.findFirst({
    where: {
      organizationId: input.organizationId,
      ...(id ? { id } : { code: legacyCode }),
      status: "ACTIVE",
      isSettlement: true,
    },
    select: {
      id: true,
      code: true,
      nameEn: true,
      nameAr: true,
      baseMethod: true,
      requiresReference: true,
      status: true,
      isSettlement: true,
    },
  });
  if (!config || !paymentMethodIsSettlement(config)) return null;

  return {
    id: config.id,
    code: config.code,
    nameEn: config.nameEn,
    nameAr: config.nameAr,
    baseMethod: config.baseMethod as SettlementBaseMethod,
    requiresReference: config.requiresReference,
  };
}

export function paymentMethodReferenceError(
  method: Pick<SettlementPaymentMethod, "requiresReference">,
  reference: string,
) {
  return method.requiresReference && !reference.trim()
    ? "payment_method_reference_required" as const
    : null;
}

export function paymentMethodSnapshot(
  method: Pick<SettlementPaymentMethod, "id" | "code" | "nameEn" | "nameAr" | "baseMethod">,
) {
  return {
    paymentMethodConfigId: method.id,
    paymentMethodCodeSnapshot: method.code,
    paymentMethodNameEnSnapshot: method.nameEn,
    paymentMethodNameArSnapshot: method.nameAr,
    method: method.baseMethod,
  };
}
