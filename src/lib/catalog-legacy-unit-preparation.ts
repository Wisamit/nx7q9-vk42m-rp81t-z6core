/**
 * Legacy reference-range/unit preparation keeps a deliberately narrow alias
 * normalization; it does not imply clinical unit conversion or UCUM equivalence.
 */
export function legacyPreparedUnitKey(value: string): string {
  return value.trim().toUpperCase().replace(/[µμ]/g, "U")
    .replace(/\s+/g, "").replace(/PER/g, "/").replace(/\.$/, "");
}

export type LegacyPreparedUnit = { id: string; code: string; symbol: string; status: string };
export type LegacyUnitResolution =
  | { kind: "resolved"; unitId: string }
  | { kind: "unknown" }
  | { kind: "ambiguous_or_inactive" };

/** A conflicting code/symbol, or any inactive master, is never overwritten. */
export function registerLegacyPreparedUnitAlias(
  aliases: Map<string, string | null>,
  alias: string,
  unitId: string,
  status: string,
): void {
  const key = legacyPreparedUnitKey(alias);
  if (!key || !unitId) return;
  if (status !== "ACTIVE") {
    aliases.set(key, null);
  } else if (!aliases.has(key)) {
    aliases.set(key, unitId);
  } else if (aliases.get(key) !== unitId) {
    aliases.set(key, null);
  }
}

export function indexLegacyPreparedUnits(units: readonly LegacyPreparedUnit[]): Map<string, string | null> {
  const aliases = new Map<string, string | null>();
  for (const unit of units) {
    registerLegacyPreparedUnitAlias(aliases, unit.code, unit.id, unit.status);
    registerLegacyPreparedUnitAlias(aliases, unit.symbol, unit.id, unit.status);
  }
  return aliases;
}

export function resolveLegacyPreparedUnit(
  aliases: ReadonlyMap<string, string | null>, raw: string,
): LegacyUnitResolution {
  const key = legacyPreparedUnitKey(raw);
  if (!key || !aliases.has(key)) return { kind: "unknown" };
  const id = aliases.get(key);
  return id ? { kind: "resolved", unitId: id } : { kind: "ambiguous_or_inactive" };
}

/** A unit source value must not be truncated into a different stable identifier. */
export function proposedLegacyUnitCode(raw: string): string | null {
  const normalized = legacyPreparedUnitKey(raw)
    .replace(/[^A-Z0-9/.*^-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  const code = "LEG_" + (normalized || "UNIT");
  return raw.trim() && raw.trim().length <= 50 && code.length <= 50 ? code : null;
}

/** Never materialize from processed, failed or provenance-less source rows. */
export function eligibleLegacyUnitSourceRow(
  row: { entityType: string; status: string; importedEntityId: string | null },
): boolean {
  if (row.entityType === "TEST") {
    return row.status === "IMPORTED" && !!row.importedEntityId;
  }
  return row.entityType === "REFERENCE_INTERVAL" &&
    (row.status === "VALID" || row.status === "WARNING") && !row.importedEntityId;
}
