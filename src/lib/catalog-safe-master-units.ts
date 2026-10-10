import { sameImportTestIdentity } from "./catalog-panel-membership.ts";

/**
 * Legacy UNIT codes and symbols are aliases, not unique clinical identities.
 * Conflicting aliases are permanently ambiguous within an import transaction.
 */
export function registerSafeMasterUnitAlias(
  aliases: Map<string, string | null>, rawAlias: string, unitId: string,
): void {
  const key = rawAlias.trim().toUpperCase();
  if (!key || !unitId) return;
  if (!aliases.has(key)) aliases.set(key, unitId);
  else if (aliases.get(key) !== unitId) aliases.set(key, null);
}

export type SafeMasterUnitResolution =
  | { ok: true; unitId: string | null }
  | { ok: false; reason: "UNKNOWN_OR_AMBIGUOUS_TEST_UNIT" };

export function resolveSafeMasterUnitAlias(
  aliases: ReadonlyMap<string, string | null>, rawUnit: string,
): SafeMasterUnitResolution {
  const key = rawUnit.trim().toUpperCase();
  if (!key) return { ok: true, unitId: null };
  const unitId = aliases.get(key);
  if (!unitId) return { ok: false, reason: "UNKNOWN_OR_AMBIGUOUS_TEST_UNIT" };
  return { ok: true, unitId };
}

/** A matching code/name alone cannot authorize a new clinical panel link. */
export function sameSafeMasterTestDefinition(
  existing: {
    nameEn: string; status: string; defaultUnitId: string | null;
    assay: string | null; collectionInstructions: string | null;
    methodId: string | null; specimenTypeId: string | null; containerId: string | null;
    resultType: string; workflowType: string;
  },
  source: {
    nameEn: string; unitId: string | null;
    assay: string; collection: string;
  },
): boolean {
  const clean = (value: string | null): string => (value ?? "").trim();
  return existing.status === "ACTIVE" &&
    sameImportTestIdentity(existing.nameEn, source.nameEn) &&
    existing.defaultUnitId === source.unitId &&
    clean(existing.assay) === clean(source.assay) &&
    clean(existing.collectionInstructions) === clean(source.collection) &&
    existing.methodId === null &&
    existing.specimenTypeId === null &&
    existing.containerId === null &&
    existing.resultType === "NUMERIC" &&
    existing.workflowType === "GENERAL";
}

/** Never silently truncate a stable import code or clinical display name. */
export function fitsSafeMasterIdentity(code: string, name: string, codeMax: number, nameMax: number): boolean {
  return !!code && !!name && code.length <= codeMax && name.length <= nameMax;
}
