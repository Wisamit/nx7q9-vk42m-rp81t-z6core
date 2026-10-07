import test from "node:test";
import assert from "node:assert/strict";
import {
  activeDerivedAliquotConflict,
  receptionAssessmentError,
  selectedRejectionOrderItemIds,
  selectiveRejectionNeedsPatientRecollection,
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
