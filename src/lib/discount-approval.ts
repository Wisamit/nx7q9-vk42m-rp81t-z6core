import { createHash } from "node:crypto";

export type DiscountPricingEntry = {
  kind: "TEST" | "PACKAGE";
  id: string;
  priceReferenceId: string;
  unitPrice: string;
};

export function discountApprovalFingerprint(input: {
  organizationId: string;
  branchId: string;
  patientId: string;
  sourceId: string;
  referrerId: string | null;
  clientId: string | null;
  directTestIds: string[];
  packageIds: string[];
  discountPercent: string;
  discountReason: string;
  currency: string;
  pricing: DiscountPricingEntry[];
}) {
  const normalized = {
    organizationId: input.organizationId,
    branchId: input.branchId,
    patientId: input.patientId,
    sourceId: input.sourceId,
    referrerId: input.referrerId,
    clientId: input.clientId,
    directTestIds: [...input.directTestIds].sort(),
    packageIds: [...input.packageIds].sort(),
    discountPercent: input.discountPercent,
    discountReason: input.discountReason.trim(),
    currency: input.currency,
    pricing: [...input.pricing]
      .map(item => ({
        kind: item.kind,
        id: item.id,
        priceReferenceId: item.priceReferenceId,
        unitPrice: item.unitPrice,
      }))
      .sort((a, b) => (a.kind + ":" + a.id).localeCompare(b.kind + ":" + b.id)),
  };

  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
