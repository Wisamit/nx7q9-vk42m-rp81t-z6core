import test from "node:test";
import assert from "node:assert/strict";
import { patientMergeEligibility } from "../src/lib/patient-merge.ts";

function patient(overrides: Partial<{
  id: string;
  organizationId: string;
  status: string;
  mergedIntoPatientId: string | null;
  portalAccount: { id: string } | null;
}> = {}) {
  return {
    id: "P1",
    organizationId: "ORG1",
    status: "ACTIVE",
    mergedIntoPatientId: null,
    portalAccount: null,
    ...overrides,
  };
}

test("patient merge accepts two active canonical records in the same organization", () => {
  assert.deepEqual(patientMergeEligibility(patient(), patient({ id: "P2" })), { ok: true });
});

test("patient merge rejects self merge and cross-organization merge", () => {
  assert.equal(patientMergeEligibility(patient(), patient()).error, "same_patient");
  assert.equal(patientMergeEligibility(patient(), patient({ id: "P2", organizationId: "ORG2" })).error, "organization_mismatch");
});

test("patient merge rejects inactive or already merged source/target", () => {
  assert.equal(patientMergeEligibility(patient({ status: "INACTIVE" }), patient({ id: "P2" })).error, "source_not_mergeable");
  assert.equal(patientMergeEligibility(patient({ mergedIntoPatientId: "P9" }), patient({ id: "P2" })).error, "source_not_mergeable");
  assert.equal(patientMergeEligibility(patient(), patient({ id: "P2", status: "INACTIVE" })).error, "target_not_canonical");
  assert.equal(patientMergeEligibility(patient(), patient({ id: "P2", mergedIntoPatientId: "P9" })).error, "target_not_canonical");
});

test("patient merge blocks two separate portal identities from being silently combined", () => {
  const source = patient({ portalAccount: { id: "PORTAL1" } });
  const target = patient({ id: "P2", portalAccount: { id: "PORTAL2" } });
  assert.equal(patientMergeEligibility(source, target).error, "portal_account_conflict");
});
