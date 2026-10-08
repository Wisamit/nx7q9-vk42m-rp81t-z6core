import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("patient master schema preserves creation branch and extended demographics", () => {
  const schema = source("prisma/schema.prisma");
  assert.ok(schema.includes("whatsapp"));
  assert.ok(schema.includes("addressEn"));
  assert.ok(schema.includes("addressAr"));
  assert.ok(schema.includes("clinicalInformation"));
  assert.ok(schema.includes("creationBranchId"));
  assert.ok(schema.includes('PatientCreationBranch'));
});

test("patient registration persists active branch as immutable creation context", () => {
  const route = source("src/app/api/patients/route.ts");
  assert.ok(route.includes("creationBranchId: session.activeBranchId || null"));
  assert.ok(route.includes("whatsapp: whatsapp || null"));
  assert.ok(route.includes("clinicalInformation: clinicalInformation || null"));
});

test("patient registration preserves standard National ID and Passport semantics through governed schemes", () => {
  const route = source("src/app/api/patients/route.ts");
  assert.ok(route.includes('schemeByCode.get("NATIONAL_ID")'));
  assert.ok(route.includes('schemeByCode.get("PASSPORT")'));
  assert.ok(route.includes("passportIssuingCountry"));
  assert.ok(route.includes("identifier_already_used"));
  assert.ok(route.includes("organizationId_schemeId_normalizedValue"));
});

test("patient detail exposes calculated age, creation branch and extended demographics", () => {
  const page = source("src/app/patients/[id]/page.tsx");
  assert.ok(page.includes("calculatePatientAge"));
  assert.ok(page.includes("patient.creationBranch"));
  assert.ok(page.includes("patient.whatsapp"));
  assert.ok(page.includes("patient.clinicalInformation"));
});
