import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("patient merge event stores immutable source and target identity snapshots", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20261008094000_patient_merge_identity_snapshots/migration.sql");
  const route = source("src/app/api/patients/[id]/merge/route.ts");

  assert.ok(schema.includes("sourceIdentitySnapshot"));
  assert.ok(schema.includes("targetIdentitySnapshot"));
  assert.ok(schema.includes("duplicateEvidenceSnapshot"));
  assert.ok(migration.includes("source_identity_snapshot"));
  assert.ok(migration.includes("target_identity_snapshot"));
  assert.ok(route.includes("mergeIdentitySnapshot(source)"));
  assert.ok(route.includes("mergeIdentitySnapshot(target)"));
});

test("patient merge snapshots active identifiers before changing source status", () => {
  const route = source("src/app/api/patients/[id]/merge/route.ts");
  const identifierQuery = route.indexOf('identifiers: {');
  const snapshot = route.indexOf("const sourceIdentitySnapshot");
  const claim = route.indexOf("const claimed = await tx.patient.updateMany");
  assert.ok(identifierQuery >= 0);
  assert.ok(snapshot > identifierQuery);
  assert.ok(claim > snapshot);
});

test("patient merge audit carries duplicate evidence snapshot", () => {
  const route = source("src/app/api/patients/[id]/merge/route.ts");
  assert.ok(route.includes("patientDuplicateEvidence(source, target)"));
  assert.ok(route.includes("duplicateEvidenceSnapshot,"));
  assert.ok(route.includes("PATIENT_MERGED"));
});
