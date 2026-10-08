import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSpecimenPlans,
  specimenCollectionVolumeError,
  specimenRequirementEventDetails,
  specimenRequirementSnapshotFromDetails,
} from "../src/lib/specimen-requirement-engine.ts";

test("compatible tests share one specimen and minimum volume is summed", () => {
  const plans = buildSpecimenPlans([
    {
      orderItemId: "OI-1", testId: "T-1", testCode: "GLU",
      specimenTypeId: "SERUM", specimenTypeCode: "SERUM",
      containerId: "SST", containerCode: "SST",
      minimumVolume: "0.500", minimumVolumeUnit: "mL",
      collectionInstructions: "Allow to clot", storageConditions: "2-8 C", stabilityMinutes: 240,
    },
    {
      orderItemId: "OI-2", testId: "T-2", testCode: "ALT",
      specimenTypeId: "SERUM", specimenTypeCode: "SERUM",
      containerId: "SST", containerCode: "SST",
      minimumVolume: "0.300", minimumVolumeUnit: "mL",
      collectionInstructions: "Allow to clot", storageConditions: "2-8 C", stabilityMinutes: 240,
    },
  ]);

  assert.equal(plans.length, 1);
  assert.equal(plans[0].shared, true);
  assert.equal(plans[0].requiredVolume, "0.800");
  assert.equal(plans[0].requiredVolumeUnit, "mL");
  assert.deepEqual(plans[0].orderItemIds, ["OI-1", "OI-2"]);
});

test("different storage, stability or volume units produce separate specimen plans", () => {
  const common = {
    specimenTypeId: "PLASMA", specimenTypeCode: "PLASMA",
    containerId: "EDTA", containerCode: "EDTA",
    collectionInstructions: null,
  };
  const plans = buildSpecimenPlans([
    { ...common, orderItemId: "1", testId: "1", testCode: "A", minimumVolume: "1.000", minimumVolumeUnit: "mL", storageConditions: "2-8 C", stabilityMinutes: 60 },
    { ...common, orderItemId: "2", testId: "2", testCode: "B", minimumVolume: "1.000", minimumVolumeUnit: "uL", storageConditions: "2-8 C", stabilityMinutes: 60 },
    { ...common, orderItemId: "3", testId: "3", testCode: "C", minimumVolume: "1.000", minimumVolumeUnit: "mL", storageConditions: "Frozen", stabilityMinutes: 60 },
    { ...common, orderItemId: "4", testId: "4", testCode: "D", minimumVolume: "1.000", minimumVolumeUnit: "mL", storageConditions: "2-8 C", stabilityMinutes: 120 },
  ]);
  assert.equal(plans.length, 4);
  assert.ok(plans.every(plan => !plan.shared));
});

test("missing specimen type is isolated and marked incomplete instead of being shared", () => {
  const plans = buildSpecimenPlans([
    { orderItemId: "1", testId: "1", testCode: "A", specimenTypeId: null, specimenTypeCode: null, containerId: null, containerCode: null, minimumVolume: null, minimumVolumeUnit: null, collectionInstructions: null, storageConditions: null, stabilityMinutes: null },
    { orderItemId: "2", testId: "2", testCode: "B", specimenTypeId: null, specimenTypeCode: null, containerId: null, containerCode: null, minimumVolume: null, minimumVolumeUnit: null, collectionInstructions: null, storageConditions: null, stabilityMinutes: null },
  ]);
  assert.equal(plans.length, 2);
  assert.ok(plans.every(plan => plan.configurationComplete === false));
});

test("unknown minimum volume never invents an aggregate requirement", () => {
  const plans = buildSpecimenPlans([
    { orderItemId: "1", testId: "1", testCode: "A", specimenTypeId: "S", specimenTypeCode: "S", containerId: "C", containerCode: "C", minimumVolume: "0.500", minimumVolumeUnit: "mL", collectionInstructions: null, storageConditions: null, stabilityMinutes: null },
    { orderItemId: "2", testId: "2", testCode: "B", specimenTypeId: "S", specimenTypeCode: "S", containerId: "C", containerCode: "C", minimumVolume: null, minimumVolumeUnit: "mL", collectionInstructions: null, storageConditions: null, stabilityMinutes: null },
  ]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].requiredVolume, null);
  assert.equal(plans[0].volumeRequirementComplete, false);
});

test("collection requires configured minimum volume and matching unit", () => {
  assert.equal(specimenCollectionVolumeError({ requiredVolume: "1.250", requiredVolumeUnit: "mL", collectedVolume: null, collectedVolumeUnit: null }), "specimen_volume_required");
  assert.equal(specimenCollectionVolumeError({ requiredVolume: "1.250", requiredVolumeUnit: "mL", collectedVolume: "1.249", collectedVolumeUnit: "mL" }), "insufficient_specimen_volume");
  assert.equal(specimenCollectionVolumeError({ requiredVolume: "1.250", requiredVolumeUnit: "mL", collectedVolume: "1250.000", collectedVolumeUnit: "uL" }), "specimen_volume_unit_mismatch");
  assert.equal(specimenCollectionVolumeError({ requiredVolume: "1.250", requiredVolumeUnit: "mL", collectedVolume: "1.250", collectedVolumeUnit: "mL" }), null);
});

test("requirement snapshot reader accepts only explicit finalized metadata", () => {
  const finalized = {
    requirementsFinalized: true,
    requiredVolume: "0.800",
    requiredVolumeUnit: "mL",
    volumeRequirementComplete: true,
    collectionInstructions: ["Allow to clot"],
    storageConditions: "2-8 C",
    stabilityMinutes: 240,
    shared: true,
    configurationComplete: true,
    requirementMembers: [{ testCode: "GLU" }],
  };
  assert.equal(specimenRequirementSnapshotFromDetails({ requiredVolume: "0.800" }), null);
  assert.deepEqual(specimenRequirementSnapshotFromDetails(finalized), {
    requirementEngineVersion: 1,
    requirementSource: "LEGACY_FINALIZATION",
    requirementCapturedAt: null,
    specimenTypeId: null,
    specimenTypeCode: null,
    specimenTypeNameEn: null,
    specimenTypeNameAr: null,
    containerId: null,
    containerCode: null,
    containerNameEn: null,
    containerNameAr: null,
    requiredVolume: "0.800",
    requiredVolumeUnit: "mL",
    volumeRequirementComplete: true,
    patientPreparation: [],
    collectionInstructions: ["Allow to clot"],
    storageConditions: "2-8 C",
    stabilityMinutes: 240,
    shared: true,
    configurationComplete: true,
    requirementMembers: [{ testCode: "GLU" }],
  });
});


test("order-time requirement event snapshots preserve pre-analytical configuration", () => {
  const plan = buildSpecimenPlans([{
    orderItemId: "OI-1",
    testId: "T-1",
    testCode: "GLU",
    specimenTypeId: "SPEC-1",
    specimenTypeCode: "SERUM",
    specimenTypeNameEn: "Serum",
    specimenTypeNameAr: "مصل",
    containerId: "CONT-1",
    containerCode: "SST",
    containerNameEn: "Serum separator tube",
    containerNameAr: "أنبوب فصل المصل",
    minimumVolume: "0.500",
    minimumVolumeUnit: "mL",
    patientPreparation: "Fasting 8 hours",
    collectionInstructions: "Allow to clot",
    storageConditions: "2-8 C",
    stabilityMinutes: 240,
  }])[0];

  const capturedAt = new Date("2026-10-08T01:00:00.000Z");
  const details = specimenRequirementEventDetails(plan, {
    requirementSource: "ORDER_REGISTRATION_SNAPSHOT",
    capturedAt,
    extra: { barcode: "ORD-01" },
  });
  const snapshot = specimenRequirementSnapshotFromDetails(details);

  assert.ok(snapshot);
  assert.equal(snapshot.requirementEngineVersion, 2);
  assert.equal(snapshot.requirementSource, "ORDER_REGISTRATION_SNAPSHOT");
  assert.equal(snapshot.requirementCapturedAt, capturedAt.toISOString());
  assert.equal(snapshot.specimenTypeCode, "SERUM");
  assert.equal(snapshot.specimenTypeNameEn, "Serum");
  assert.equal(snapshot.containerCode, "SST");
  assert.equal(snapshot.containerNameEn, "Serum separator tube");
  assert.deepEqual(snapshot.patientPreparation, ["Fasting 8 hours"]);
  assert.deepEqual(snapshot.collectionInstructions, ["Allow to clot"]);
  assert.equal(snapshot.requiredVolume, "0.500");
  assert.equal(snapshot.storageConditions, "2-8 C");
  assert.equal(snapshot.stabilityMinutes, 240);
});

test("legacy finalized snapshots remain readable without inventing missing order-time evidence", () => {
  const snapshot = specimenRequirementSnapshotFromDetails({
    requirementsFinalized: true,
    requiredVolume: "1.000",
    requiredVolumeUnit: "mL",
    volumeRequirementComplete: true,
    collectionInstructions: ["Legacy instruction"],
    configurationComplete: true,
    requirementMembers: [],
  });
  assert.ok(snapshot);
  assert.equal(snapshot.requirementEngineVersion, 1);
  assert.equal(snapshot.requirementSource, "LEGACY_FINALIZATION");
  assert.equal(snapshot.requirementCapturedAt, null);
  assert.equal(snapshot.specimenTypeCode, null);
  assert.equal(snapshot.containerCode, null);
  assert.deepEqual(snapshot.patientPreparation, []);
});
