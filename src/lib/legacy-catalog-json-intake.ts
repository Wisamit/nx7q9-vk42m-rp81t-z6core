/** Bound cleaned legacy configuration intake before JSON allocation and parsing. */
export const LEGACY_CATALOG_JSON_MAX_BYTES = 32 * 1024 * 1024;

export class LegacyCatalogJsonIntakeError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function legacyCatalogSourceNameValid(name: unknown): name is string {
  return typeof name === "string" && name.trim().length > 0 &&
    name.length <= 255 && !/[\u0000-\u001f\u007f]/.test(name);
}

/** Content-Length is only a preflight hint; enforce actual streamed bytes. */
export async function readLegacyCatalogJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    throw new LegacyCatalogJsonIntakeError("legacy_catalog_json_required", 415);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (!Number.isSafeInteger(declared) || declared < 0 ||
      declared > LEGACY_CATALOG_JSON_MAX_BYTES) {
    throw new LegacyCatalogJsonIntakeError("legacy_catalog_payload_too_large", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new LegacyCatalogJsonIntakeError("legacy_catalog_payload_missing");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > LEGACY_CATALOG_JSON_MAX_BYTES) {
      await reader.cancel("legacy_catalog_payload_too_large");
      throw new LegacyCatalogJsonIntakeError("legacy_catalog_payload_too_large", 413);
    }
    chunks.push(part.value);
  }
  if (!total) throw new LegacyCatalogJsonIntakeError("legacy_catalog_payload_missing");
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true })
      .decode(Buffer.concat(chunks))) as unknown;
  } catch {
    throw new LegacyCatalogJsonIntakeError("legacy_catalog_invalid_json_or_utf8");
  }
}
