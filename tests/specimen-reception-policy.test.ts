import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  activeDerivedAliquotConflict,
  receptionAssessmentError,
  receptionAcceptanceError,
  selectedRejectionOrderItemIds,
  selectiveRejectionNeedsPatientRecollection,
  rejectionAnalyticalWorkError,
} from "../src/lib/specimen-reception-policy.ts";

test("reception assessment requires discrepancy details for quality mismatches", () => {
  assert.equal(receptionAssessmentError({
    labelAssessment: "MATCHED", conditionCode: "GOOD", temperatureC: "4.2",
    expectedContainerCode: "EDTA", observedContainerCode: "EDTA", discrepancyText: null,
  }), null);
  assert.equal(receptionAssessmentError({
    labelAssessment: "MISMATCHED", conditionCode: "GOOD", temperatureC: null,
    expectedContainerCode: "EDTA", observedContainerCode: "EDTA", discrepancyText: null,
  }), "reception_discrepancy_details_required");
  assert.equal(receptionAssessmentError({
    labelAssessment: "MATCHED", conditionCode: "GOOD", temperatureC: null,
    expectedContainerCode: "EDTA", observedContainerCode: "SERUM", discrepancyText: "",
  }), "reception_discrepancy_details_required");
  assert.equal(receptionAssessmentError({
    labelAssessment: "MATCHED", conditionCode: "GOOD", temperatureC: "500",
    expectedContainerCode: null, observedContainerCode: null, discrepancyText: null,
  }), "invalid_temperature_c");
});

test("whole and selected-test rejection only operate on active specimen links", () => {
  assert.deepEqual(selectedRejectionOrderItemIds({
    scope: "WHOLE_SPECIMEN",
    activeOrderItemIds: ["A","B"],
    requestedOrderItemIds: [],
  }), ["A","B"]);
  assert.deepEqual(selectedRejectionOrderItemIds({
    scope: "SELECTED_TESTS",
    activeOrderItemIds: ["A","B"],
    requestedOrderItemIds: ["B"],
  }), ["B"]);
  assert.equal(selectedRejectionOrderItemIds({
    scope: "SELECTED_TESTS",
    activeOrderItemIds: ["A","B"],
    requestedOrderItemIds: ["C"],
  }), null);
  assert.equal(selectedRejectionOrderItemIds({
    scope: "SELECTED_TESTS",
    activeOrderItemIds: ["A","B"],
    requestedOrderItemIds: [],
  }), null);
});

test("aliquot rejection never silently becomes patient recollection", () => {
  assert.equal(selectiveRejectionNeedsPatientRecollection("ALIQUOT"), false);
  assert.equal(selectiveRejectionNeedsPatientRecollection("RECOLLECTION"), true);
  assert.equal(selectiveRejectionNeedsPatientRecollection(null), true);
});

test("affected tests cannot be rejected while an active derived aliquot still carries them", () => {
  assert.equal(activeDerivedAliquotConflict({
    affectedOrderItemIds: ["A"],
    childAliquots: [
      { status: "RECEIVED", orderItemIds: ["A"] },
    ],
  }), true);
  assert.equal(activeDerivedAliquotConflict({
    affectedOrderItemIds: ["A"],
    childAliquots: [
      { status: "RECEIVED", orderItemIds: ["B"] },
      { status: "REJECTED", orderItemIds: ["A"] },
    ],
  }), false);
});


test("pre-analytical rejection stops once any affected analytical workflow has started", () => {
  const clean = {
    orderItemStatus: "COLLECTED",
    resultCount: 0,
    microbiologyCount: 0,
    activeSendOutCount: 0,
    analyzerWorkCount: 0,
  };
  assert.equal(rejectionAnalyticalWorkError([clean]), null);
  assert.equal(rejectionAnalyticalWorkError([{ ...clean, resultCount: 1 }]), "affected_tests_already_have_results");
  assert.equal(rejectionAnalyticalWorkError([{ ...clean, orderItemStatus: "IN_PROGRESS" }]), "affected_tests_analytical_work_started");
  assert.equal(rejectionAnalyticalWorkError([{ ...clean, microbiologyCount: 1 }]), "affected_tests_microbiology_work_started");
  assert.equal(rejectionAnalyticalWorkError([{ ...clean, activeSendOutCount: 1 }]), "affected_tests_sendout_active");
  assert.equal(rejectionAnalyticalWorkError([{ ...clean, analyzerWorkCount: 1 }]), "affected_tests_analyzer_work_started");
});


test("discrepant reception fails closed before specimen becomes RECEIVED", () => {
  const valid = { labelAssessment: "MATCHED", conditionCode: "GOOD", expectedContainerCode: "EDTA", observedContainerCode: "EDTA" };
  assert.equal(receptionAcceptanceError(valid), null);
  assert.equal(receptionAcceptanceError({ ...valid, labelAssessment: "UNLABELED" }), "reception_label_exception_requires_resolution");
  assert.equal(receptionAcceptanceError({ ...valid, labelAssessment: "MISMATCHED" }), "reception_label_exception_requires_resolution");
  assert.equal(receptionAcceptanceError({ ...valid, conditionCode: "CLOTTED" }), "reception_condition_exception_requires_resolution");
  assert.equal(receptionAcceptanceError({ ...valid, observedContainerCode: "SERUM" }), "reception_container_mismatch_requires_resolution");
});

test("denied reception is audited and never transitions a discrepant specimen to RECEIVED", () => {
  const fs = requireSource();
  const accepted = fs.indexOf("const acceptanceError = receptionAcceptanceError(");
  const denied = fs.indexOf('action: "SPECIMEN_RECEPTION_EXCEPTION_OBSERVED"');
  const receipt = fs.indexOf('status: "RECEIVED"');
  assert.ok(accepted >= 0 && denied > accepted && receipt > denied);
  assert.ok(fs.includes("specimenStatusUnchanged: specimen.status"));
});

function requireSource() {
  return readFileSync(new URL("../src/app/api/specimens/[id]/actions/route.ts", import.meta.url), "utf8");
}

test("rejection rechecks source branch, order state and child aliquots inside transaction", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/rejections/route.ts", import.meta.url), "utf8");
  const lockIndex = route.indexOf("const sourceChange = await tx.specimen.updateMany");
  const childIndex = route.indexOf("const currentChildren = await tx.specimen.findMany");
  const recordIndex = route.indexOf("const rejection = await tx.specimenRejection.create");
  assert.ok(lockIndex >= 0 && childIndex > lockIndex && recordIndex > childIndex);
  assert.ok(route.includes("currentBranchId: branchId,\n            order: { status: { notIn:"));
  assert.ok(route.includes("parentRelationType: \"ALIQUOT\""));
  assert.ok(route.includes("currentChildren.some(child =>"));
});

test("successful and failed collection require active orders and current custody branch atomically", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/collection-attempts/route.ts", import.meta.url), "utf8");
  assert.equal(route.split('order: { status: { notIn: ["CANCELLED", "COMPLETED"] } }').length - 1, 2);
  assert.equal(route.split('currentBranchId: branchId,\n').length >= 3, true);
  assert.ok(route.includes('specimen.order.status === "CANCELLED" || specimen.order.status === "COMPLETED"'));
});
