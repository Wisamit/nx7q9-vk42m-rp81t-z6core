import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("label reprint decisions serialize on the specimen row", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/label-print/route.ts", import.meta.url), "utf8");
  const tx = route.indexOf("const outcome = await prisma.$transaction");
  const lock = route.indexOf("FOR UPDATE", tx);
  const count = route.indexOf("const priorPrintCount = await tx.auditEvent.count", tx);
  const policy = route.indexOf("const policyError = specimenLabelPrintError", tx);
  const audit = route.indexOf("await tx.auditEvent.create", tx);
  assert.ok(tx >= 0 && lock > tx && count > lock && policy > count && audit > policy);
  assert.ok(route.includes("SELECT id, status FROM specimens"));
  assert.ok(route.includes("status: lock[0].status"));
  assert.ok(route.includes('action: "SPECIMEN_LABEL_PRINTED"'));
  assert.ok(route.includes('reason: priorPrintCount > 0 ? reason : null'));
  assert.ok(route.includes('printSequence: priorPrintCount + 1'));
  assert.ok(!route.includes("await prisma.auditEvent.count"));
});
