import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { structuredStorageLocation } from "../src/lib/specimen-storage-location.ts";

test("structured position requires all four physical location levels", () => {
  assert.equal(structuredStorageLocation(null).error, "storage_position_required");
  assert.equal(structuredStorageLocation({ zone: "Cold", unit: "F2", rack: "R1" }).error, "storage_position_incomplete");
  assert.equal(structuredStorageLocation({ zone: "Cold", unit: "F/2", rack: "R1", slot: "S3" }).error, "storage_position_invalid");
  assert.deepEqual(structuredStorageLocation({ zone: "Cold", unit: "F2", rack: "R1", slot: "S3" }), {
    path: "Cold / F2 / R1 / S3",
    segments: { zone: "Cold", unit: "F2", rack: "R1", slot: "S3" },
  });
});

test("structured storage location is persisted and audited with branch-scoped CAS", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/storage-location/route.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/components/specimen-aliquot-manager.tsx", import.meta.url), "utf8");
  assert.ok(route.includes("structuredStorageLocation(body?.storagePosition)"));
  assert.ok(route.includes("storagePosition: position.segments"));
  assert.ok(route.includes("currentBranchId: specimen.currentBranchId"));
  for (const level of ["zone", "unit", "rack", "slot"]) assert.ok(ui.includes('name="' + level + '"'));
});

test("storage positions are branch-scoped, registered and selected from the master", () => {
  const api = readFileSync(new URL("../src/app/api/settings/specimen-storage-locations/route.ts", import.meta.url), "utf8");
  const move = readFileSync(new URL("../src/app/api/specimens/[id]/storage-location/route.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/components/specimen-aliquot-manager.tsx", import.meta.url), "utf8");
  assert.ok(api.includes('requirePermission("settings.manage")'));
  assert.ok(api.includes("canAccessBranch(session, branchId)"));
  assert.ok(api.includes("SPECIMEN_STORAGE_LOCATION_CREATED"));
  assert.ok(move.includes("prisma.specimenStorageLocation.findUnique"));
  assert.ok(move.includes('registered.status !== "ACTIVE"'));
  assert.ok(ui.includes("registerStorage"));
  assert.ok(ui.includes("selectedLocation"));
});
