export type CatalogExportType =
  "TEST" | "COMPONENT" | "UNIT" | "REFERENCE_INTERVAL" | "PRICE_LIST" | "PRICE_LIST_ITEM";

export const catalogExportTypes = new Set<CatalogExportType>([
  "TEST", "COMPONENT", "UNIT", "REFERENCE_INTERVAL", "PRICE_LIST", "PRICE_LIST_ITEM",
]);

/** Cursor is only a sortable UUID key, never a record lookup or a trust token. */
export function catalogExportNavigation(cursor: string | null):
  | { ok: true; cursor: string | null }
  | { ok: false } {
  if (cursor === null || cursor === "") return { ok: true, cursor: null };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)) {
    return { ok: false };
  }
  return { ok: true, cursor: cursor.toLowerCase() };
}

/** No staged import or live commit is inferred from an exported configuration. */
export function exportBundle(
  batches: ReadonlyArray<{ entityType: CatalogExportType; records: readonly unknown[] }>,
  organizationId: string,
  exportedAt: string,
) {
  return {
    format: "family-lab-catalog-bundle",
    schemaVersion: 1,
    organizationId,
    exportedAt,
    consistency: "paged-live-not-atomic",
    groups: batches,
  };
}
