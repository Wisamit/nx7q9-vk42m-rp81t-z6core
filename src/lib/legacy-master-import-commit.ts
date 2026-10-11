import type { Prisma } from "../../generated/prisma/client";
import type { LegacyMasterKind, LegacyMasterRow } from "./legacy-master-data-import";

export type NewLegacyMasterRow = LegacyMasterRow & { id: string };

/** Create-only dispatch: database uniqueness and the caller's serializable
 * transaction protect existing organization-scoped master data. */
export async function createLegacyMasterRecords(
  tx: Prisma.TransactionClient,
  kind: LegacyMasterKind,
  organizationId: string,
  entries: readonly NewLegacyMasterRow[],
): Promise<void> {
  if (kind === "REFERRER") {
    await tx.referrer.createMany({ data: entries.map(row => ({
      id: row.id, organizationId, code: row.code, nameEn: row.nameEn,
      nameAr: row.nameAr, type: row.type!, phone: row.phone,
      email: row.email, licenseNumber: row.licenseNumber,
    })) });
  } else if (kind === "SOURCE") {
    await tx.orderSource.createMany({ data: entries.map(row => ({
      id: row.id, organizationId, code: row.code, nameEn: row.nameEn,
      nameAr: row.nameAr, category: row.category!,
    })) });
  } else if (kind === "ORGANISM") {
    await tx.organism.createMany({ data: entries.map(row => ({
      id: row.id, organizationId, code: row.code, nameEn: row.nameEn,
      nameAr: row.nameAr, category: row.category,
    })) });
  } else if (kind === "ANTIBIOTIC") {
    await tx.antibiotic.createMany({ data: entries.map(row => ({
      id: row.id, organizationId, code: row.code, nameEn: row.nameEn,
      nameAr: row.nameAr, drugClass: row.drugClass,
    })) });
  } else {
    throw new Error("unsupported_master_kind");
  }
}
