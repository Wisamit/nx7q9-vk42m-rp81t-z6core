import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("exact barcode scan never reveals a patient from a branch outside current custody scope", () => {
  const page = readFileSync(new URL("../src/app/specimens/scan/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("barcode,"));
  assert.ok(page.includes("currentBranchId: { in: branchIds }"));
  assert.ok(!page.includes("{ order: { orderingBranchId: { in: branchIds } } }"));
  assert.ok(page.includes('requirePermission("specimens.view")'));
});
