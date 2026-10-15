import { createHash, timingSafeEqual } from "node:crypto";

/** Fail-closed persisted attachment integrity guard; never return altered bytes. */
export function verifiedAttachmentBytes(
  stored: Uint8Array, expectedSize: number, expectedSha256: string,
): Uint8Array | null {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || stored.length !== expectedSize ||
      !/^[0-9a-f]{64}$/i.test(expectedSha256)) return null;
  const calculated = createHash("sha256").update(stored).digest();
  const expected = Buffer.from(expectedSha256, "hex");
  return timingSafeEqual(calculated, expected) ? new Uint8Array(stored) : null;
}
