import { createHmac, timingSafeEqual } from "node:crypto";

export type BundleAttestationStatus = "VERIFIED" | "UNVERIFIED";
const PURPOSE = "family-lab/catalog-configuration-bundle/attestation/v1\n";
const SIGNATURE = /^[0-9a-f]{64}$/;

/**
 * Separate secret is preferred; existing application encryption secret is
 * supported as a backwards-compatible fallback with domain-separated HMAC.
 * Secrets must be deployment-managed, never persisted in export or audit data.
 */
export function catalogBundleSigningSecret(env: Record<string, string | undefined>): string | null {
  const value = env.CATALOG_BUNDLE_SIGNING_KEY ?? env.APP_ENCRYPTION_KEY;
  if (!value || Buffer.byteLength(value, "utf8") < 32 ||
      value.startsWith("replace-with-")) return null;
  return value;
}

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export function canonicalJson(value: Json): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("bundle_non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("bundle_not_json_object");
  }
  return "{" + Object.keys(value).sort().map(key => {
    const part = value[key];
    if (part === undefined) throw new Error("bundle_undefined_field");
    return JSON.stringify(key) + ":" + canonicalJson(part);
  }).join(",") + "}";
}

function isObject(value: unknown): value is Record<string, Json> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function signatureFor(bundle: Record<string, Json>, secret: string) {
  return createHmac("sha256", secret).update(PURPOSE).update(canonicalJson(bundle as Json)).digest("hex");
}

/** Sign exactly the JSON value sent to the browser, not Prisma/Date instances. */
export function attestCatalogBundle(bundle: Record<string, Json>, secret: string) {
  if (!isObject(bundle) || Object.hasOwn(bundle, "attestation")) {
    throw new Error("bundle_attestation_already_present");
  }
  const signature = signatureFor(bundle, secret);
  return { ...bundle, attestation: { version: 1, algorithm: "HMAC-SHA256", signature } };
}

export class CatalogBundleAttestationError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/**
 * An unsigned old bundle may still be staged as UNVERIFIED source evidence.
 * A present but malformed/incorrect signature is always rejected, never
 * silently downgraded. Verification does NOT approve or activate any content.
 */
export function verifyCatalogBundleAttestation(value: unknown, secret: string | null): BundleAttestationStatus {
  if (!isObject(value)) throw new CatalogBundleAttestationError("bundle_invalid_attestation");
  if (!Object.hasOwn(value, "attestation")) return "UNVERIFIED";
  const a = value.attestation;
  if (!isObject(a) || a.version !== 1 || a.algorithm !== "HMAC-SHA256" ||
      typeof a.signature !== "string" || !SIGNATURE.test(a.signature) ||
      Object.keys(a).length !== 3) {
    throw new CatalogBundleAttestationError("bundle_invalid_attestation");
  }
  if (!secret) throw new CatalogBundleAttestationError("bundle_attestation_key_unavailable", 503);
  const unsigned = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "attestation")
  ) as Record<string, Json>;
  let expected: Buffer;
  try {
    expected = Buffer.from(signatureFor(unsigned, secret), "hex");
  } catch {
    throw new CatalogBundleAttestationError("bundle_invalid_attestation");
  }
  const actual = Buffer.from(a.signature, "hex");
  if (!timingSafeEqual(expected, actual)) {
    throw new CatalogBundleAttestationError("bundle_attestation_mismatch", 409);
  }
  return "VERIFIED";
}
