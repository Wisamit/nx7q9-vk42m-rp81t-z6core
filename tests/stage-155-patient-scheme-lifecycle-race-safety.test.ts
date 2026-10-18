import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Stage 155: identifier scheme lifecycle locks tenant before state and audit mutations", () => {
  const schemes = readFileSync("src/app/api/patients/identifier-schemes/route.ts","utf8");
  const registration = readFileSync("src/app/api/patients/route.ts","utf8");
  const identifiers = readFileSync("src/app/api/patients/[id]/identifiers/route.ts","utf8");
  const post = schemes.slice(schemes.indexOf("export async function POST"), schemes.indexOf("export async function PATCH"));
  const patch = schemes.slice(schemes.indexOf("export async function PATCH"));
  for (const body of [post,patch]) {
    const tx = body.indexOf("await prisma.$transaction(async tx => {");
    const lock = body.indexOf("SELECT id FROM organizations",tx);
    assert.ok(tx >= 0 && lock > tx);
    assert.ok(body.includes("status = 'ACTIVE'") && body.includes("FOR UPDATE"));
    assert.ok(body.indexOf("tx.patientIdentifierScheme.",lock)>lock);
  }
  const schemeLookup = patch.indexOf("const scheme = await tx.patientIdentifierScheme.findFirst({");
  const mutation = patch.indexOf("const changed = await tx.patientIdentifierScheme.updateMany({");
  const audit = patch.indexOf('action: "PATIENT_IDENTIFIER_SCHEME_DEACTIVATED"');
  assert.ok(schemeLookup > patch.indexOf("FOR UPDATE") && mutation > schemeLookup && audit > mutation);
  assert.ok(!patch.slice(0,patch.indexOf("await prisma.$transaction")).includes("prisma.patientIdentifierScheme.findFirst"));
  assert.ok(patch.includes('scheme.identifierType !== "OTHER" || scheme.code === "LEGACY_OTHER"'));
  assert.ok(patch.includes('status: "INACTIVE", deactivatedAt'));
  assert.match(patch, /where:\\s*\\{\\s*id: scheme\\.id,\\s*organizationId: session\\.user\\.organizationId,\\s*status: "ACTIVE"/);
  assert.ok(post.includes('action: "PATIENT_IDENTIFIER_SCHEME_CREATED"'));
  const regLock = registration.indexOf("SELECT id FROM organizations");
  const lockedSchemes = registration.indexOf("const liveSchemes = await tx.patientIdentifierScheme.findMany",regLock);
  const duplicate = registration.indexOf("const duplicateRows =", lockedSchemes);
  const patientWrite = registration.indexOf("const patient = await tx.patient.create",duplicate);
  assert.ok(regLock>=0 && lockedSchemes>regLock && duplicate>lockedSchemes && patientWrite>duplicate);
  assert.ok(registration.includes("identifier_scheme_changed"));
  assert.ok(registration.includes('status: "ACTIVE"'));
  assert.ok(registration.includes("currentById.get(identifier.schemeId)"));
  assert.ok(identifiers.includes("SELECT id FROM organizations"));
});

test("Stage155: audited scheme disabling never releases historical identifier uniqueness", () => {
  const schema = readFileSync("prisma/schema.prisma","utf8");
  const routes = readFileSync("src/app/api/patients/identifier-schemes/route.ts","utf8");
  assert.ok(schema.includes("@@unique([organizationId, schemeId, normalizedValue])"));
  assert.ok(routes.includes('data: { status: "INACTIVE", deactivatedAt }'));
  assert.ok(!routes.includes("patientIdentifier.delete"));
});
