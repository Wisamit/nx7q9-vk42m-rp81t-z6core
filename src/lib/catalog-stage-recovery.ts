/** Recovery is read-only. An opaque staging key must never authorize a new write. */
export const RECOVERABLE_STAGE_SOURCES = [
  "LEGACY_MDB_EXPORT", "CSV_REVIEW", "CONFIG_BUNDLE_REVIEW",
] as const;
export type RecoverableStageSource = typeof RECOVERABLE_STAGE_SOURCES[number];

export function isRecoverableStageSource(value: string | null): value is RecoverableStageSource {
  return RECOVERABLE_STAGE_SOURCES.some(source => source === value);
}

/** The client only uses an exact, opaque batch pointer; never treat HTTP 200 alone as success. */
export function validateCatalogStageRecovery(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return record.found === true && typeof record.id === "string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(record.id)
    ? record.id : null;
}
