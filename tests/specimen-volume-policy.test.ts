import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  aliquotPurposeRequiresTests,
  minorToVolume3,
  reconciledVolumeError,
  reconciliationUsageFloorError,
  remainingAfterUse,
  specimenVolumeUseError,
  volume3ToMinor,
  volumeUnitsMatch,
  specimenRejectionLineageError,
  derivedAliquotInitialStatus,
} from "../src/lib/specimen-volume-policy.ts";

test("specimen volume math is exact to three decimals", () => {
  assert.equal(volume3ToMinor("1.250"), BigInt(1250));
  assert.equal(volume3ToMinor("0.001"), BigInt(1));
  assert.equal(minorToVolume3(BigInt(1250)), "1.250");
  assert.equal(remainingAfterUse("2.000", "0.333"), "1.667");
  assert.equal(volume3ToMinor("1e2"), null);
  assert.equal(volume3ToMinor("1.0001"), null);
  assert.equal(volume3ToMinor("-1"), null);
});

test("aliquot and usage volume require usable status, known balance and matching unit", () => {
  assert.equal(specimenVolumeUseError({
    status: "RECEIVED", remainingVolume: "2.000", remainingVolumeUnit: "mL",
    requestedVolume: "0.500", requestedVolumeUnit: "ml",
  }), null);
  assert.equal(specimenVolumeUseError({
    status: "RECEIVED", remainingVolume: null, remainingVolumeUnit: null,
    requestedVolume: "0.500", requestedVolumeUnit: "mL",
  }), "available_volume_reconciliation_required");
  assert.equal(specimenVolumeUseError({
    status: "IN_TRANSIT", remainingVolume: "2.000", remainingVolumeUnit: "mL",
    requestedVolume: "0.500", requestedVolumeUnit: "mL",
  }), "specimen_status_not_usable");
  assert.equal(specimenVolumeUseError({
    status: "RECEIVED", remainingVolume: "0.250", remainingVolumeUnit: "mL",
    requestedVolume: "0.500", requestedVolumeUnit: "mL",
  }), "insufficient_available_volume");
  assert.equal(specimenVolumeUseError({
    status: "RECEIVED", remainingVolume: "2.000", remainingVolumeUnit: "mL",
    requestedVolume: "0.500", requestedVolumeUnit: "uL",
  }), "volume_unit_mismatch");
});

test("historical volume reconciliation never silently exceeds known collected volume", () => {
  assert.equal(reconciledVolumeError({
    status: "COLLECTED", originalVolume: "3.000", originalVolumeUnit: "mL",
    availableVolume: "2.500", availableVolumeUnit: "ml",
  }), null);
  assert.equal(reconciledVolumeError({
    status: "COLLECTED", originalVolume: "3.000", originalVolumeUnit: "mL",
    availableVolume: "3.001", availableVolumeUnit: "mL",
  }), "available_volume_exceeds_original");
  assert.equal(reconciledVolumeError({
    status: "REJECTED", originalVolume: "3.000", originalVolumeUnit: "mL",
    availableVolume: "1.000", availableVolumeUnit: "mL",
  }), "specimen_status_not_reconcilable");
  assert.equal(reconciledVolumeError({
    status: "RECEIVED", originalVolume: null, originalVolumeUnit: null, trackedVolumeUnit: "mL",
    availableVolume: "1.000", availableVolumeUnit: "uL",
  }), "volume_unit_mismatch");
  assert.equal(volumeUnitsMatch("mL", " ml "), true);
});

test("testing and send-out aliquots require explicit linked tests", () => {
  assert.equal(aliquotPurposeRequiresTests("TESTING"), true);
  assert.equal(aliquotPurposeRequiresTests("SEND_OUT"), true);
  assert.equal(aliquotPurposeRequiresTests("STORAGE"), false);
  assert.equal(aliquotPurposeRequiresTests("OTHER"), false);
});


test("specimen rejection blocks any active derived aliquot descendants at the direct child level", () => {
  assert.equal(specimenRejectionLineageError([
    { parentRelationType: "ALIQUOT", status: "RECEIVED" },
  ]), "active_child_aliquots_require_resolution");
  assert.equal(specimenRejectionLineageError([
    { parentRelationType: "ALIQUOT", status: "REJECTED" },
    { parentRelationType: "RECOLLECTION", status: "COLLECTED" },
  ]), null);
});


test("derived aliquots never inherit an in-process state without their own processing step", () => {
  assert.equal(derivedAliquotInitialStatus("COLLECTED"), "COLLECTED");
  assert.equal(derivedAliquotInitialStatus("RECEIVED"), "RECEIVED");
  assert.equal(derivedAliquotInitialStatus("IN_PROCESS"), "RECEIVED");
  assert.equal(derivedAliquotInitialStatus("IN_TRANSIT"), null);
});

test("aliquot API rejects closed orders and requires active parent-linked tests", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/aliquots/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes('parent.order.status === "CANCELLED"'));
  assert.ok(route.includes('parent.order.status === "COMPLETED"'));
  assert.ok(route.includes('error: "aliquot_no_active_order_items"'));
  assert.ok(route.includes('orderItems: { some: { status: "ACTIVE"'));
});

test("reconciliation cannot reissue volume already consumed by aliquots or testing", () => {
  assert.equal(reconciliationUsageFloorError({ originalVolume: "5.000", availableVolume: "3.500", usageTotal: "1.500" }), null);
  assert.equal(reconciliationUsageFloorError({ originalVolume: "5.000", availableVolume: "4.000", usageTotal: "1.500" }), "reconciliation_would_restore_consumed_volume");
  assert.equal(reconciliationUsageFloorError({ originalVolume: null, availableVolume: "2.000", usageTotal: "1.000" }), "reconciliation_original_volume_required_after_usage");
  assert.equal(reconciliationUsageFloorError({ originalVolume: null, availableVolume: "2.000", usageTotal: "0.000" }), null);
});

test("volume reconciliation locks specimen custody and checks usage inside transaction", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/volume-reconcile/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes("currentBranchId: specimen.currentBranchId"));
  assert.ok(route.indexOf("specimen.updateMany") < route.indexOf("specimenUsageEvent.aggregate"));
  assert.ok(route.includes("reconciliationUsageFloorError"));
});
