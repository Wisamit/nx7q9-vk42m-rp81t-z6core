import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
const uuid = (value: unknown): string | null =>
  typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
const sameId = (a: unknown, b: unknown): boolean =>
  uuid(a) !== null && uuid(a) === uuid(b);
const optionalId = (a: unknown, b: unknown): boolean =>
  a === null && b === null || sameId(a, b);
const nonEmptySame = (a: unknown, b: unknown): boolean =>
  typeof a === "string" && a.length > 0 && a === b;

export type MappingReason =
  "INVALID_SOURCE_IDENTITY" | "TARGET_RECORD_ID_MISMATCH" |
  "PRIMARY_CODE_MISMATCH" | "PARENT_IDENTITY_MISMATCH" |
  "BRANCH_OR_TARIFF_SCOPE_MISMATCH" | "COMPOSITE_MEMBERSHIP_MISMATCH" |
  "UNSUPPORTED_CLASS";

export type TargetIdentityObservation = {
  status: "LOCAL_IDENTITY_OBSERVED" | "MAPPING_REQUIRED";
  reasons: MappingReason[];
  sourceInstanceProven: false;
  portableSourceIds: false;
  mappingApproved: false;
  reviewOnly: true;
  autoApplyAllowed: false;
};

/**
 * Pure, bounded, value-free mapping evidence. Live records MUST be fetched by
 * the caller using current organization/branch/department/price scope.
 *
 * Equality is an observation about the *current* local record, never proof of
 * export-instance identity or authority to import these IDs into another DB.
 * Do not use this classification as an apply or signatory grant.
 */
export function observeCatalogTargetIdentity(
  entityType: string, sourceValue: unknown, liveValue: unknown,
): TargetIdentityObservation {
  const source = object(sourceValue), live = object(liveValue);
  const reasons = new Set<MappingReason>();
  const fail = (reason: MappingReason): void => { reasons.add(reason); };
  if (!catalogExportTypes.has(entityType as CatalogExportType)) {
    fail("UNSUPPORTED_CLASS");
  } else if (!source || !live || !uuid(source.id) || !uuid(live.id)) {
    fail("INVALID_SOURCE_IDENTITY");
  } else {
    const type = entityType as CatalogExportType;
    if (!sameId(source.id, live.id)) fail("TARGET_RECORD_ID_MISMATCH");
    if (type !== "REFERENCE_INTERVAL" && type !== "PRICE_LIST_ITEM" &&
        type !== "PRICE_LIST_PACKAGE_ITEM" &&
        !nonEmptySame(source.code, live.code)) fail("PRIMARY_CODE_MISMATCH");

    const parent = (...fields: string[]) => {
      if (fields.some(field => !Object.hasOwn(source, field) ||
          !Object.hasOwn(live, field) ||
          !optionalId(source[field], live[field]))) fail("PARENT_IDENTITY_MISMATCH");
    };
    const linkedCode = (s: unknown, l: unknown) => {
      if (!nonEmptySame(object(s)?.code, object(l)?.code))
        fail("PARENT_IDENTITY_MISMATCH");
    };
    const scope = (s: Record<string, unknown> | null, l: Record<string, unknown> | null) => {
      if (!s || !l || !nonEmptySame(s.scopeType, l.scopeType) ||
          !nonEmptySame(s.currency, l.currency) ||
          !optionalId(s.branchId, l.branchId) ||
          (s.scopeType !== "ORGANIZATION" && s.scopeType !== "BRANCH") ||
          (s.scopeType === "ORGANIZATION" && s.branchId !== null) ||
          (s.scopeType === "BRANCH" && uuid(s.branchId) === null) ||
          ["sourceId","referrerId","clientId","contractId"].some(f =>
            !Object.hasOwn(s,f) || !Object.hasOwn(l,f) ||
            s[f] !== null || l[f] !== null))
        fail("BRANCH_OR_TARIFF_SCOPE_MISMATCH");
    };
    if (type === "TEST") parent("departmentId","specimenTypeId","containerId","methodId","defaultUnitId");
    if (type === "UNIT" && !nonEmptySame(source.ucumCode,live.ucumCode) &&
        !(source.ucumCode === null && live.ucumCode === null))
      fail("PARENT_IDENTITY_MISMATCH");
    if (type === "COMPONENT") {
      parent("testId","unitId","resultSectionId");
      linkedCode(source.test,live.test);
      if (source.unit === null && live.unit === null) { /* legitimate optional relation */ }
      else if (!nonEmptySame(object(source.unit)?.code,object(live.unit)?.code) ||
               !nonEmptySame(object(source.unit)?.symbol,object(live.unit)?.symbol))
        fail("PARENT_IDENTITY_MISMATCH");
    }
    if (type === "REFERENCE_INTERVAL") {
      parent("componentId","methodId","analyzerId","specimenTypeId");
      if (!Object.hasOwn(source,"branchId") || !Object.hasOwn(live,"branchId") ||
          !optionalId(source.branchId,live.branchId))
        fail("BRANCH_OR_TARIFF_SCOPE_MISMATCH");
      linkedCode(source.component,live.component);
      linkedCode(object(source.component)?.test,object(live.component)?.test);
    }
    if (type === "PRICE_LIST") {
      scope(source,live);
    }
    if (type === "PRICE_LIST_ITEM" || type === "PRICE_LIST_PACKAGE_ITEM") {
      parent("priceListId",type === "PRICE_LIST_ITEM" ? "testId" : "packageId");
      linkedCode(type === "PRICE_LIST_ITEM" ? source.test : source.package,
        type === "PRICE_LIST_ITEM" ? live.test : live.package);
      linkedCode(source.priceList,live.priceList);
      scope(object(source.priceList),object(live.priceList));
    }
    if (type === "PANEL" || type === "PACKAGE") {
      const expected = source.items, current = live.items;
      if (!Array.isArray(expected) || !Array.isArray(current) ||
          !expected.length || expected.length > 1000 ||
          expected.length !== current.length) {
        fail("COMPOSITE_MEMBERSHIP_MISMATCH");
      } else {
        const byTestId = new Map<string, Record<string, unknown>>();
        for (const value of current) {
          const member = object(value), id = uuid(member?.testId);
          if (!member || !id || byTestId.has(id)) {
            fail("COMPOSITE_MEMBERSHIP_MISMATCH"); break;
          }
          byTestId.set(id,member);
        }
        const seen = new Set<string>();
        for (const value of expected) {
          const member = object(value), id = uuid(member?.testId);
          const target = id ? byTestId.get(id) : null;
          if (!id || seen.has(id) || !target ||
              !Number.isSafeInteger(member?.displayOrder) ||
              member?.displayOrder !== target.displayOrder ||
              !nonEmptySame(object(member?.test)?.code,object(target.test)?.code) ||
              (type === "PANEL" && (typeof member?.required !== "boolean" ||
                member.required !== target.required))) {
            fail("COMPOSITE_MEMBERSHIP_MISMATCH");
          }
          if (id) seen.add(id);
        }
      }
    }
  }
  return {
    status: reasons.size ? "MAPPING_REQUIRED" : "LOCAL_IDENTITY_OBSERVED",
    reasons: [...reasons],
    sourceInstanceProven: false, portableSourceIds: false,
    mappingApproved: false, reviewOnly: true, autoApplyAllowed: false,
  };
}
