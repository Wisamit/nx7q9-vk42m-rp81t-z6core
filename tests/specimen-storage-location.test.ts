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

test("deactivation records a reason and blocks occupied storage positions", () => {
  const api = readFileSync(new URL("../src/app/api/settings/specimen-storage-locations/route.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/components/specimen-aliquot-manager.tsx", import.meta.url), "utf8");
  assert.ok(api.includes('export async function PATCH(request: Request)'));
  assert.ok(api.includes('requirePermission("settings.manage")'));
  assert.ok(api.includes('status === "INACTIVE"'));
  assert.ok(api.includes("tx.specimen.count"));
  assert.ok(api.includes('storageLocation: location.path'));
  assert.ok(api.includes('action: "SPECIMEN_STORAGE_LOCATION_STATUS_CHANGED"'));
  assert.ok(ui.includes("changeStorageStatus"));
  assert.ok(ui.includes("storage_location_has_active_specimens"));
});

test("inactive location listing requires settings permission and UI scopes requests", () => {
  const api = readFileSync(new URL("../src/app/api/settings/specimen-storage-locations/route.ts", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/components/specimen-aliquot-manager.tsx", import.meta.url), "utf8");
  assert.ok(api.includes('requirePermission(includeInactive ? "settings.manage" : "specimens.view")'));
  assert.ok(ui.includes('canManageStorageSettings ? "&includeInactive=true" : ""'));
  assert.ok(ui.includes('if (storageBusy || busy) return'));
  assert.ok(ui.includes('disabled={storageBusy || busy}'));
});


test("relocation serializes against deactivation by locking location first", () => {
  const move = readFileSync(new URL("../src/app/api/specimens/[id]/storage-location/route.ts", import.meta.url), "utf8");
  const settings = readFileSync(new URL("../src/app/api/settings/specimen-storage-locations/route.ts", import.meta.url), "utf8");
  const lockAt = move.indexOf("FOR UPDATE");
  const specimenUpdateAt = move.indexOf("const changed = await tx.specimen.updateMany");
  assert.ok(lockAt > 0 && lockAt < specimenUpdateAt);
  assert.ok(move.includes("FROM specimen_storage_locations"));
  assert.ok(move.includes("AND status = 'ACTIVE'"));
  assert.ok(settings.includes("const row = await tx.specimenStorageLocation.updateMany"));
  assert.ok(settings.includes("const occupied = await tx.specimen.count"));
});
