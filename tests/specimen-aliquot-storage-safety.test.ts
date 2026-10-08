import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("aliquot physical storage must be registered to the current branch", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/aliquots/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes("branchId_path: { branchId: currentBranchId, path: storageLocation }"));
  assert.ok(route.includes('registeredStorage.status !== "ACTIVE"'));
  assert.ok(route.includes('error: "storage_location_not_registered"'));
  assert.ok(route.includes("storageLocationId: registeredStorage?.id || null"));
});

test("aliquot locks storage master before parent volume consumption", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/aliquots/route.ts", import.meta.url), "utf8");
  const lock = route.indexOf("FOR UPDATE");
  const consume = route.indexOf("const consumed = await tx.specimen.updateMany");
  assert.ok(lock > 0 && consume > lock);
  assert.ok(route.includes("class SpecimenStorageChanged extends Error"));
  assert.ok(route.includes("if (locked.length !== 1) throw new SpecimenStorageChanged()"));
});
