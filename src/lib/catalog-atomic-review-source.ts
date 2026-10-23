import type { CatalogExportType } from "./catalog-configuration-export.ts";
import { catalogExportTypes } from "./catalog-configuration-export.ts";
import { verifyBundleFieldContract } from "./catalog-bundle-field-contract.ts";

/**
 * Client-side SHAPE validation only, not cryptographic HMAC verification.
 * The protected same-origin server owns the signed, scope-bound transaction.
 * Human-review spreadsheet files generated from this source are NOT imports,
 * configuration activation evidence, or a clinical policy endorsement.
 */
export type AtomicReviewSource = {
  format: "family-lab-catalog-bundle";
  schemaVersion: 1;
  consistency: "transactional-consistent-read";
  organizationId: string;
  exportedAt: string;
  groups: Array<{entityType: CatalogExportType; records: unknown[]}>;
};
export class AtomicReviewSourceError extends Error {
  constructor(readonly code: string) { super(code); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (v:unknown):v is Record<string,unknown> =>
  v!==null && typeof v==="object" && !Array.isArray(v);
const reject=(code:string):never=>{throw new AtomicReviewSourceError(code);};

export function checkedAtomicCatalogReviewSource(
  bundle: unknown, requestedTypes: readonly CatalogExportType[],
): AtomicReviewSource {
  if (!object(bundle) || bundle.format !== "family-lab-catalog-bundle" ||
      bundle.schemaVersion !== 1 || bundle.consistency !== "transactional-consistent-read" ||
      typeof bundle.organizationId !== "string" || !uuid.test(bundle.organizationId) ||
      typeof bundle.exportedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(bundle.exportedAt) ||
      !Number.isFinite(Date.parse(bundle.exportedAt)) ||
      new Date(bundle.exportedAt).toISOString() !== bundle.exportedAt ||
      !Array.isArray(bundle.groups) || bundle.groups.length !== requestedTypes.length ||
      !requestedTypes.length || requestedTypes.length > catalogExportTypes.size ||
      new Set(requestedTypes).size !== requestedTypes.length ||
      requestedTypes.some(t=>!catalogExportTypes.has(t)))
    return reject("atomic_review_source_contract_invalid");
  for(const [index,raw] of bundle.groups.entries()){
    if (!object(raw) || raw.entityType !== requestedTypes[index] ||
        !Array.isArray(raw.records) || raw.records.length > 5000)
      return reject("atomic_review_group_or_order_invalid");
    const ids = new Set<string>();
    for(const entry of raw.records) {
      if (!object(entry) || typeof entry.id !== "string" ||
          !uuid.test(entry.id) || ids.has(entry.id.toLowerCase()))
        return reject("atomic_review_immutable_identity_invalid");
      ids.add(entry.id.toLowerCase());
    }
  }
  // All ten classes require the full current v1 field manifest and
  // complete nested source shape. Old/partial "signed" source is not silently
  // upgraded, and source identity alone is not an authorization to write.
  try {
    if(verifyBundleFieldContract(bundle)!=="COMPLETE_SOURCE_FIELD_PROJECTION")
      return reject("atomic_review_full_field_contract_required");
  } catch(error){
    if(error instanceof AtomicReviewSourceError) throw error;
    return reject("atomic_review_full_field_contract_invalid");
  }
  return bundle as AtomicReviewSource;
}
