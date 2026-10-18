import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Stage154: identifier creation and deactivation lock the ACTIVE tenant before looking up mutable identity", () => {
  const route = readFileSync("src/app/api/patients/[id]/identifiers/route.ts", "utf8");
  const create = readFileSync("src/app/api/patients/route.ts", "utf8");
  const edit = readFileSync("src/app/api/patients/[id]/route.ts", "utf8");
  const post = route.slice(route.indexOf("export async function POST"),route.indexOf("export async function PATCH"));
  const patch = route.slice(route.indexOf("export async function PATCH"));
  for (const body of [post,patch]) {
    const start = body.indexOf("await prisma.$transaction(async tx => {");
    const lock = body.indexOf("SELECT id FROM organizations",start);
    const patient = body.indexOf("const patient = await tx.patient.findFirst({",lock);
    assert.ok(start >= 0 && lock > start && patient > lock);
    assert.ok(body.includes("status = 'ACTIVE'"));
    assert.ok(body.includes("FOR UPDATE"));
    assert.ok(body.includes('status: "ACTIVE", mergedIntoPatientId: null'));
    assert.ok(body.indexOf("tx.patientIdentifier.",patient)>patient);
    assert.ok(!body.slice(0,start).includes("prisma.patient.findFirst("));
    assert.ok(!body.slice(0,start).includes("prisma.patientIdentifier.find"));
  }
  assert.ok(create.includes("SELECT id FROM organizations"));
  assert.ok(edit.includes("SELECT id FROM organizations"));
  assert.ok(post.includes('action: "PATIENT_IDENTIFIER_ADDED"'));
  assert.ok(patch.includes('action: "PATIENT_IDENTIFIER_DEACTIVATED"'));
  assert.ok(patch.includes('data: { status: "INACTIVE" }'));
  assert.ok(patch.includes('reason,'));
  assert.ok(patch.includes("replacementPrimaryIdentifierId"));
  assert.ok(patch.includes("!remaining.some(item => item.isPrimary)"));
  assert.ok(post.includes("organizationId_schemeId_normalizedValue"));
  assert.ok(post.includes('error: "identifier_already_used"'));
});

test("Stage154: patient merge locks before taking source/target snapshots and step-up", () => {
  const route = readFileSync("src/app/api/patients/[id]/merge/route.ts", "utf8");
  const start = route.indexOf("await prisma.$transaction(async tx =>");
  const lock = route.indexOf("SELECT id FROM organizations",start);
  const pair = route.indexOf("const [source, target] = await Promise.all(",lock);
  const identifiers = route.indexOf("identifiers: {",pair);
  const stepUp = route.indexOf("consumeStaffStepUp(tx",identifiers);
  const snapshot = route.indexOf("mergeIdentitySnapshot(source)",stepUp);
  const claim = route.indexOf("const claimed = await tx.patient.updateMany",snapshot);
  assert.ok(start >= 0 && lock > start && pair > lock && identifiers > pair &&
    stepUp > identifiers && snapshot > stepUp && claim > snapshot);
  assert.ok(route.includes("Prisma.TransactionIsolationLevel.Serializable"));
  assert.ok(route.includes("patientMergeEligibility(source, target)"));
  assert.ok(route.includes("organization_unavailable"));
  assert.ok(route.includes('"PATIENT_MERGED"'));
  assert.ok(route.includes('"PATIENT_MERGE_RECEIVED"'));
  assert.ok(route.includes("tx.patientMergeEvent.create"));
});
