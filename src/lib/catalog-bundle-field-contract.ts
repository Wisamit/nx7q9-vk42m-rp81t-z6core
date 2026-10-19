import { catalogBundleAllowedSourceFields, catalogBundleNestedSourceProjections, type BundleNestedProjection } from "./catalog-bundle-source-boundary.ts";
import type { CatalogExportType } from "./catalog-configuration-export.ts";

const uuidRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export type BundleFieldContract = {
  version: 1;
  classes: Array<{ entityType: CatalogExportType; fields: string[] }>;
};
export type BundleFieldContractStatus = "COMPLETE_SOURCE_FIELD_PROJECTION" | "LEGACY_NO_FIELD_CONTRACT";

export class BundleFieldContractError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/** V1 field manifest is signed as part of the original server HMAC payload. */
export function bundleFieldContract(types: readonly CatalogExportType[]): BundleFieldContract {
  const seen = new Set<string>();
  return {
    version: 1,
    classes: types.map(entityType => {
      if (!Object.hasOwn(catalogBundleAllowedSourceFields, entityType) || seen.has(entityType)) {
        throw new BundleFieldContractError("bundle_field_contract_invalid_type");
      }
      seen.add(entityType);
      return {
        entityType,
        fields: [...catalogBundleAllowedSourceFields[entityType]].sort(),
      };
    }),
  };
}

/**
 * V1 also requires exact nested Prisma relation shapes, not just top-level
 * fields. Incomplete related master identities can hide a real source drift.
 * A null optional COMPONENT.unit is legitimate; no other relation may vanish.
 */
function verifyNestedProjection(
  value: unknown, shape: BundleNestedProjection | readonly [BundleNestedProjection],
  entityType: CatalogExportType, path: string,
): void {
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) {
      throw new BundleFieldContractError("bundle_field_contract_incomplete_nested_source");
    }
    for (const item of value) {
      verifyNestedProjection(item, shape[0], entityType, path + "[]");
    }
    return;
  }
  if (!uuidRecord(value)) {
    throw new BundleFieldContractError("bundle_field_contract_incomplete_nested_source");
  }
  const projection = shape as BundleNestedProjection;
  const expectedKeys = Object.keys(projection).sort();
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys)) {
    throw new BundleFieldContractError("bundle_field_contract_incomplete_nested_source");
  }
  for (const [field, childShape] of Object.entries(projection)) {
    if (childShape === true) continue;
    const childPath = path ? path + "." + field : field;
    // The component's unit relation is genuinely nullable in Prisma.
    if (entityType === "COMPONENT" && childPath === "unit" && value[field] === null) continue;
    verifyNestedProjection(value[field], childShape, entityType, childPath);
  }
}

/**
 * A versioned manifest ensures that every signed snapshot record contains
 * every field declared by the allowed source schema. Nulls MUST be explicit.
 * No historical unsigned/old signed bundles are upgraded to complete parity.
 *
 * This covers source presence, not domain approval or live apply.
 */
export function verifyBundleFieldContract(bundle: unknown): BundleFieldContractStatus {
  if (!uuidRecord(bundle) || !Array.isArray(bundle.groups)) {
    throw new BundleFieldContractError("bundle_field_contract_invalid_bundle");
  }
  if (!Object.hasOwn(bundle, "fieldContract")) return "LEGACY_NO_FIELD_CONTRACT";
  const groups = bundle.groups;
  const types = groups.map(group => {
    if (!uuidRecord(group) || typeof group.entityType !== "string" ||
        !Object.hasOwn(catalogBundleAllowedSourceFields, group.entityType)) {
      throw new BundleFieldContractError("bundle_field_contract_invalid_group");
    }
    return group.entityType as CatalogExportType;
  });
  const expected = bundleFieldContract(types);
  // The source is untrusted even if signed: do not accept invented field
  // lists, missing groups, reordered classes or partially populated rows.
  if (JSON.stringify(bundle.fieldContract) !== JSON.stringify(expected)) {
    throw new BundleFieldContractError("bundle_field_contract_mismatch");
  }
  for (const [i, group] of groups.entries()) {
    const records = (group as { records?: unknown }).records;
    if (!Array.isArray(records)) {
      throw new BundleFieldContractError("bundle_field_contract_invalid_records");
    }
    const fields = expected.classes[i].fields;
    for (const item of records) {
      if (!uuidRecord(item)) {
        throw new BundleFieldContractError("bundle_field_contract_invalid_record");
      }
      const actual = Object.keys(item).sort();
      if (JSON.stringify(actual) !== JSON.stringify(fields)) {
        throw new BundleFieldContractError("bundle_field_contract_incomplete_source");
      }
      // Assert actual nested related fields for all selected classes. This
      // prevents a signed but partially projected relation from claiming parity.
      for (const [name, projection] of Object.entries(catalogBundleNestedSourceProjections[types[i]])) {
        if (types[i] === "COMPONENT" && name === "unit" && item[name] === null) continue;
        verifyNestedProjection(item[name], projection as BundleNestedProjection | readonly [BundleNestedProjection], types[i], name);
      }
    }
  }
  return "COMPLETE_SOURCE_FIELD_PROJECTION";
}
