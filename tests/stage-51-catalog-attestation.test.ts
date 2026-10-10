import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  attestCatalogBundle, catalogBundleSigningSecret, verifyCatalogBundleAttestation,
  CatalogBundleAttestationError,
} from "../src/lib/catalog-bundle-attestation.ts";
import { parseCatalogBundleForReview } from "../src/lib/catalog-bundle-review.ts";

const org = "11111111-1111-4111-8111-111111111111";
const uid = "22222222-2222-4222-8222-222222222222";
const secret = "stage-51-dedicated-test-only-secret-32-bytes";
const source = {
  format: "family-lab-catalog-bundle",
  schemaVersion: 1,
  organizationId: org, exportedAt: "2026-10-10T00:00:00.000Z",
  consistency: "transactional-consistent-read",
  groups: [{ entityType: "PRICE_LIST_ITEM", records: [{
    id: uid, priceListId: uid, testId: uid, test: { code: "TST" },
    priceList: { code: "ORG", scopeType: "ORGANIZATION", branchId: null },
    unitPrice: "123.4500", effectiveFrom: "2026-01-01T00:00:00.000Z", status: "ACTIVE",
  }] }],
};

const reject = (bundle: unknown, code: string, signingSecret: string | null = secret) => {
  assert.throws(() => verifyCatalogBundleAttestation(bundle, signingSecret), error =>
    error instanceof CatalogBundleAttestationError && error.code === code, code);
};

test("Stage 51: signature covers nested medical/financial records, tenant, timestamps and row order", () => {
  const signed = attestCatalogBundle(source, secret);
  assert.equal(verifyCatalogBundleAttestation(signed, secret), "VERIFIED");
  assert.equal(signed.attestation.version, 1);
  assert.equal(signed.attestation.algorithm, "HMAC-SHA256");
  assert.equal(signed.attestation.signature.length, 64);
  const parsed = parseCatalogBundleForReview(signed, org, { pricing: true, ranges: true });
  assert.equal(parsed.rows[0].normalized.unitPrice, "123.4500");

  // Whitespace / property order changes in valid JSON are not content changes.
  const reordered = {
    attestation: signed.attestation, groups: source.groups, consistency: source.consistency,
    exportedAt: source.exportedAt, organizationId: org,
    schemaVersion: 1, format: source.format,
  };
  assert.equal(verifyCatalogBundleAttestation(reordered, secret), "VERIFIED");

  for (const changed of [
    { ...signed, organizationId: "99999999-9999-4999-8999-999999999999" },
    { ...signed, exportedAt: "2026-10-11T00:00:00.000Z" },
    { ...signed, consistency: "paged-live-not-atomic" },
    { ...signed, groups: [{ ...source.groups[0], records: [{
      ...source.groups[0].records[0], unitPrice: "123.4501",
    }] }] },
    { ...signed, groups: [{ ...source.groups[0], records: [{
      ...source.groups[0].records[0], test: { code: "OTHER" },
    }] }] },
    { ...signed, groups: [] },
  ]) reject(changed, "bundle_attestation_mismatch");
  reject(signed, "bundle_attestation_mismatch", "a-different-signing-key-at-least-32-bytes");
});

test("Stage 51: invalid signatures never silently downgrade; unsigned historical bundles remain unverified", () => {
  assert.equal(verifyCatalogBundleAttestation(source, secret), "UNVERIFIED");
  assert.equal(verifyCatalogBundleAttestation({ ...source, consistency: "paged-live-not-atomic" }, secret), "UNVERIFIED");
  const signed = attestCatalogBundle(source, secret);
  reject({ ...signed, attestation: null }, "bundle_invalid_attestation");
  reject({ ...signed, attestation: { ...signed.attestation, signature: "00" } }, "bundle_invalid_attestation");
  reject({ ...signed, attestation: { ...signed.attestation, version: 2 } }, "bundle_invalid_attestation");
  reject({ ...signed, attestation: { ...signed.attestation, signature: "0".repeat(64) } }, "bundle_attestation_mismatch");
  reject(signed, "bundle_attestation_key_unavailable", null);
  assert.equal(catalogBundleSigningSecret({ APP_ENCRYPTION_KEY: "short" }), null);
  assert.equal(catalogBundleSigningSecret({ APP_ENCRYPTION_KEY: "replace-with-at-least-32-random-characters" }), null);
  assert.equal(catalogBundleSigningSecret({ APP_ENCRYPTION_KEY: secret }), secret);
  assert.equal(catalogBundleSigningSecret({
    APP_ENCRYPTION_KEY: secret, CATALOG_BUNDLE_SIGNING_KEY: "dedicated-signing-key-with-different-entropy",
  }), "dedicated-signing-key-with-different-entropy");
});

test("Stage 51: API signs full export and verifies before staging; audited review never writes clinical masters", () => {
  const exportRoute = readFileSync("src/app/api/catalog/configuration-export/bundle/route.ts", "utf8");
  const stageRoute = readFileSync("src/app/api/catalog/imports/bundle/route.ts", "utf8");
  const page = readFileSync("src/app/catalog/imports/[id]/page.tsx", "utf8");
  assert.match(exportRoute, /attestCatalogBundle\(JSON\.parse\(JSON\.stringify\(payload\)\), signingSecret\)/);
  assert.match(exportRoute, /bundle_signing_key_unavailable/);
  assert.match(exportRoute, /Buffer\.byteLength\(serialized, "utf8"\) > BUNDLE_REVIEW_MAX_BYTES/);
  assert.match(stageRoute, /verifyCatalogBundleAttestation\(payload, catalogBundleSigningSecret\(process\.env\)\)/);
  assert.match(stageRoute, /attestationStatus/);
  assert.match(stageRoute, /UNVERIFIED_ATOMIC_PROVENANCE/);
  assert.match(stageRoute, /sourceType: BUNDLE_REVIEW_SOURCE/);
  assert.match(stageRoute, /status: "DRAFT", validatedAt: null/);
  assert.match(stageRoute, /status: "WARNING"/);
  assert.doesNotMatch(stageRoute, /tx\.(?:labTest|unit|testComponent|referenceInterval|priceListItem)\.(?:create|update|upsert)/);
  assert.match(page, /bundleAttested/);
  assert.match(page, /Server signature verified/);
  assert.match(page, /Unverified source/);
});
