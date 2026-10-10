import { legacyPreparedUnitKey } from "./catalog-legacy-unit-preparation.ts";

export type ManualUnitCandidate = {
  code: string;
  symbol: string;
  nameEn: string;
  nameAr: string;
  ucumCode: string;
};

export type ExistingUnitIdentity = {
  id: string;
  code: string;
  symbol: string;
  status: string;
};

/**
 * An explicit manual unit is a new clinical identity, never an alias or an
 * implicit conversion of an existing unit. Enforce complete database lengths
 * and reject invisible control characters rather than truncating.
 */
export function manualUnitInputError(value: ManualUnitCandidate): string | null {
  if (!/^[A-Z0-9._-]{1,50}$/.test(value.code) || !value.symbol ||
    !value.nameEn || value.symbol.length > 50 || value.nameEn.length > 150 ||
    value.nameAr.length > 150 || value.ucumCode.length > 50 ||
    /[\x00-\x1f\x7f]/.test(value.symbol + value.nameEn + value.nameAr + value.ucumCode)) {
    return "invalid_unit_fields";
  }
  if (!legacyPreparedUnitKey(value.code) || !legacyPreparedUnitKey(value.symbol)) {
    return "invalid_unit_identity";
  }
  return null;
}

/** Includes inactive codes and symbols, and both code/symbol cross-collisions. */
export function manualUnitIdentityError(
  current: readonly ExistingUnitIdentity[],
  proposed: Pick<ManualUnitCandidate, "code" | "symbol">,
): string | null {
  const sought = new Set([legacyPreparedUnitKey(proposed.code), legacyPreparedUnitKey(proposed.symbol)]);
  if (sought.has("")) return "invalid_unit_identity";
  for (const unit of current) {
    if (sought.has(legacyPreparedUnitKey(unit.code)) ||
      sought.has(legacyPreparedUnitKey(unit.symbol))) {
      return "unit_alias_conflict";
    }
  }
  return null;
}
