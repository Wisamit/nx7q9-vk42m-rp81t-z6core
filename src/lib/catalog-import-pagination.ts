import type { Prisma } from "../../generated/prisma/client";
import { privateSpreadsheetBatchScope } from "./catalog-import-list-privacy";

export const CATALOG_IMPORT_PAGE_SIZE = 10;

/** Canonical, tightly bounded pagination; never trust URL-provided offsets. */
export function requestedCatalogImportPage(value: string | undefined): number {
  if (!value || !/^[1-9][0-9]{0,8}$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 1;
}

export function catalogImportPageBounds(requestedPage: number, visibleTotal: number) {
  if (!Number.isSafeInteger(visibleTotal) || visibleTotal < 0)
    throw new Error("catalog_import_invalid_total");
  const totalPages = Math.max(1, Math.ceil(visibleTotal / CATALOG_IMPORT_PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0
    ? Math.min(requestedPage, totalPages) : 1;
  return { page, totalPages, skip: (page - 1) * CATALOG_IMPORT_PAGE_SIZE, take: CATALOG_IMPORT_PAGE_SIZE };
}

/**
 * The exact visibility predicate MUST be shared by count and page retrieval.
 * Never paginate all imports and filter afterwards: that leaks private
 * spreadsheet/bundle existence and displaces accessible entries.
 */
export function catalogImportVisibilityWhere(input: {
  organizationId: string;
  authorId: string;
  canManage: boolean;
  canReviewRanges: boolean;
  canManagePricing: boolean;
}): Prisma.CatalogImportBatchWhereInput {
  if (!input.organizationId || !input.authorId) throw new Error("catalog_import_identity_required");
  if (!input.canManage) return { id: "00000000-0000-0000-0000-000000000000" };
  return {
    organizationId: input.organizationId,
    AND: [{
      OR: [
        { sourceType: { not: "CSV_REVIEW" } },
        { rows: { none: { entityType: "REFERENCE_INTERVAL" } } },
        ...(input.canReviewRanges ? [{ createdByUserId: input.authorId }] : []),
      ],
    }, {
      ...privateSpreadsheetBatchScope(input.authorId),
    }],
    OR: [
      { AND: [{ rows: { none: { entityType: "PRICE_LIST_ITEM" } } },
        { rows: { none: { entityType: "PRICE_LIST" } } },
        { rows: { none: { entityType: "PRICE_LIST_PACKAGE_ITEM" } } }] },
      ...(input.canManagePricing ? [{ createdByUserId: input.authorId }] : []),
    ],
  };
}
