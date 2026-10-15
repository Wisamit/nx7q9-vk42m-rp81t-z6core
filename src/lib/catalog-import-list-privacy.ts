import type { Prisma } from "../../generated/prisma/client";

/**
 * Review uploads are author-private even within one organization. This covers
 * only CSV/XLSX evidence and signed configuration-bundle review batches.
 * Historical MDB staging is handled by separate role/price/range guards.
 *
 * Keep the filter inside the database query: filtering results afterward leaks
 * pagination counts and can displace visible batches in the top-ten list.
 */
export function privateSpreadsheetBatchScope(userId: string): Prisma.CatalogImportBatchWhereInput {
  if (!userId) throw new Error("catalog_import_author_required");
  return {
    OR: [
      { sourceType: { notIn: ["CSV_REVIEW", "CONFIG_BUNDLE_REVIEW"] } },
      { createdByUserId: userId },
    ],
  };
}
