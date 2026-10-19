import { createHmac, timingSafeEqual } from "node:crypto";

export type TriageClass = "CLINICAL" | "FINANCIAL" | "CROSS_DOMAIN" | "CATALOG";
export type TriageReason = "SOURCE_VALUE_CHANGED" | "REQUIRES_DOMAIN_ASSESSMENT" | "FOLLOW_UP_REQUIRED";

const TOKEN = /^[a-f0-9]{64}$/;
const PURPOSE = "family-lab/catalog-drift-observation/v1\n";

/**
 * Every native export class must be triageable. Category identifies which
 * existing management grants permit *review only*, never who may authorize
 * clinical or financial configuration to become effective.
 */
export function bundleTriageClass(entityType: string): TriageClass | null {
  if (entityType === "PANEL" || entityType === "PACKAGE") return "CROSS_DOMAIN";
  if (["REFERENCE_INTERVAL", "TEST", "COMPONENT", "UNIT", "CONTAINER"].includes(entityType))
    return "CLINICAL";
  if (["PRICE_LIST", "PRICE_LIST_ITEM", "PRICE_LIST_PACKAGE_ITEM"].includes(entityType))
    return "FINANCIAL";
  return null;
}

export function validTriageReason(value: unknown): value is TriageReason {
  return value === "SOURCE_VALUE_CHANGED" || value === "REQUIRES_DOMAIN_ASSESSMENT" ||
    value === "FOLLOW_UP_REQUIRED";
}

export function catalogDriftObservationToken(
  secret: string, batchChecksum: string, rowNumber: number, entityType: string,
  staged: unknown, live: unknown,
): string {
  if (!/^[a-f0-9]{64}$/i.test(batchChecksum) || !Number.isSafeInteger(rowNumber) ||
      rowNumber <= 0 || !bundleTriageClass(entityType)) {
    throw new Error("invalid_drift_observation_identity");
  }
  // Both values are already JSON: exact decimals, timestamps, provenance,
  // relationships and private fields influence the digest, never the response.
  return createHmac("sha256", secret).update(PURPOSE).update(JSON.stringify([
    batchChecksum, rowNumber, entityType, staged, live,
  ])).digest("hex");
}

export function matchesCatalogDriftObservation(provided: unknown, calculated: string): boolean {
  if (typeof provided !== "string" || !TOKEN.test(provided) || !TOKEN.test(calculated)) return false;
  return timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(calculated, "hex"));
}

export function triagePermissionScope(
  category: TriageClass, permissions: ReadonlySet<string>,
): boolean {
  if (!permissions.has("catalog.manage")) return false;
  if (category === "CLINICAL") return permissions.has("catalog.reference_ranges.manage");
  if (category === "FINANCIAL") return permissions.has("pricing.manage");
  // Composite memberships affect clinically performed tests and commercial
  // packaging. Review requires BOTH present grants until policy is signed.
  if (category === "CROSS_DOMAIN") return permissions.has("catalog.reference_ranges.manage") &&
    permissions.has("pricing.manage");
  return category === "CATALOG";
}
