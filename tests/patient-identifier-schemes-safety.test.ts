import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("patient identifier schemes are normalized into a dedicated master model", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20261008102000_patient_identifier_schemes/migration.sql");

  assert.ok(schema.includes("model PatientIdentifierScheme"));
  assert.ok(schema.includes("schemeId        String"));
  assert.ok(schema.includes("@@unique([organizationId, schemeId, normalizedValue])"));
  assert.ok(migration.includes("CREATE TABLE `patient_identifier_schemes`"));
  assert.ok(migration.includes("LEGACY_OTHER"));
  assert.ok(migration.includes("patient_identifiers_org_scheme_value_key"));
  assert.ok(migration.includes("DROP INDEX `patient_identifiers_org_type_value_key`"));
});

test("new organizations receive standard identifier schemes during setup", () => {
  const setup = source("src/app/api/setup/route.ts");
  assert.ok(setup.includes("patientIdentifierScheme.createMany"));
  assert.ok(setup.includes('code: "NATIONAL_ID"'));
  assert.ok(setup.includes('code: "PASSPORT"'));
  assert.ok(setup.includes('code: "LEGACY_OTHER"'));
});

test("patient creation resolves uniqueness by scheme and supports multiple configured identifiers", () => {
  const route = source("src/app/api/patients/route.ts");
  assert.ok(route.includes("customIdentifierInput"));
  assert.ok(route.includes("organizationId_schemeId_normalizedValue"));
  assert.ok(route.includes("custom_identifier_scheme_not_available"));
  assert.ok(route.includes("identifier_issuing_country_required"));
  assert.ok(route.includes("patientIdentifier.createMany"));
  assert.ok(route.includes("schemeCode"));
});

test("patient identifier changes are soft and fully audited", () => {
  const route = source("src/app/api/patients/[id]/identifiers/route.ts");
  assert.ok(route.includes("PATIENT_IDENTIFIER_ADDED"));
  assert.ok(route.includes("PATIENT_IDENTIFIER_DEACTIVATED"));
  assert.ok(route.includes('data: { status: "INACTIVE" }'));
  assert.ok(route.includes("reason"));
  assert.ok(route.includes("organizationId_schemeId_normalizedValue"));
});

test("identifier scheme administration is organization scoped and soft-deactivated", () => {
  const route = source("src/app/api/patients/identifier-schemes/route.ts");
  assert.ok(route.includes('requirePermission("patients.manage")'));
  assert.ok(route.includes("PATIENT_IDENTIFIER_SCHEME_CREATED"));
  assert.ok(route.includes("PATIENT_IDENTIFIER_SCHEME_DEACTIVATED"));
  assert.ok(route.includes("standard_identifier_scheme_cannot_be_deactivated"));
});

test("patient merge snapshots preserve identifier scheme identity", () => {
  const route = source("src/app/api/patients/[id]/merge/route.ts");
  assert.ok(route.includes("scheme: {"));
  assert.ok(route.includes("code: true"));
  assert.ok(route.includes("nameEn: true"));
  assert.ok(route.includes("nameAr: true"));
});
