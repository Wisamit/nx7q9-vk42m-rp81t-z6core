/** Physical position is explicit and branch-scoped; historical free-text locations remain readable. */
export function structuredStorageLocation(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "storage_position_required" as const };
  const row = input as Record<string, unknown>;
  const keys = ["zone", "unit", "rack", "slot"] as const;
  const parts: string[] = [];
  for (const key of keys) {
    const value = row[key];
    if (typeof value !== "string" || !value.trim()) return { error: "storage_position_incomplete" as const };
    const part = value.trim();
    if (part.length > 40 || /[\/\\\r\n\x00-\x1f]/.test(part)) return { error: "storage_position_invalid" as const };
    parts.push(part);
  }
  const path = parts.join(" / ");
  if (path.length > 200) return { error: "storage_position_invalid" as const };
  return { path, segments: { zone: parts[0], unit: parts[1], rack: parts[2], slot: parts[3] } };
}
