import test from "node:test";
import assert from "node:assert/strict";
import {
  collectionLocationError,
  failedCollectionReasonError,
  verifyCollectionPatientIdentity,
} from "../src/lib/phlebotomy-policy.ts";

const patient = {
  fullNameEn: "Mona Ali Hassan",
  fullNameAr: "منى علي حسن",
  patientNumber: "P-20261007-ABC123",
  dateOfBirth: "1992-04-18",
  normalizedPhone: "+971501234567",
  identifiers: [
    { identifierType: "NATIONAL_ID", normalizedValue: "784199212345671", status: "ACTIVE" },
    { identifierType: "PASSPORT", normalizedValue: "A1234567", status: "INACTIVE" },
  ],
};

test("collection identity requires name plus a distinct matching secondary identifier", () => {
  const dob = verifyCollectionPatientIdentity({
    patient,
    enteredName: "  Mona   Ali Hassan ",
    secondaryType: "DATE_OF_BIRTH",
    secondaryValue: "1992-04-18",
  });
  assert.equal(dob.ok, true);
  if (dob.ok) assert.equal(dob.secondarySnapshot, "1992-04-18");

  const arabic = verifyCollectionPatientIdentity({
    patient,
    enteredName: "منى علي حسن",
    secondaryType: "PATIENT_NUMBER",
    secondaryValue: "p-20261007-abc123",
  });
  assert.equal(arabic.ok, true);
});

test("phone and active external identifiers are matched without persisting the full sensitive value", () => {
  const phone = verifyCollectionPatientIdentity({
    patient,
    enteredName: patient.fullNameEn,
    secondaryType: "PHONE",
    secondaryValue: "+971 50 123 4567",
  });
  assert.equal(phone.ok, true);
  if (phone.ok) assert.equal(phone.secondarySnapshot, "••••4567");

  const external = verifyCollectionPatientIdentity({
    patient,
    enteredName: patient.fullNameEn,
    secondaryType: "EXTERNAL_IDENTIFIER",
    secondaryValue: "784-1992-1234567-1",
  });
  assert.equal(external.ok, true);
  if (external.ok) {
    assert.equal(external.secondarySnapshot, "NATIONAL_ID ••••5671");
    assert.equal(external.secondarySnapshot.includes("784199212345671"), false);
  }
});

test("collection identity rejects name mismatch, wrong secondary value and inactive identifiers", () => {
  assert.deepEqual(
    verifyCollectionPatientIdentity({
      patient,
      enteredName: "Different Person",
      secondaryType: "DATE_OF_BIRTH",
      secondaryValue: patient.dateOfBirth!,
    }),
    { ok: false, error: "patient_name_verification_failed" },
  );

  assert.deepEqual(
    verifyCollectionPatientIdentity({
      patient,
      enteredName: patient.fullNameEn,
      secondaryType: "PHONE",
      secondaryValue: "0500000000",
    }),
    { ok: false, error: "patient_secondary_verification_failed" },
  );

  assert.deepEqual(
    verifyCollectionPatientIdentity({
      patient,
      enteredName: patient.fullNameEn,
      secondaryType: "EXTERNAL_IDENTIFIER",
      secondaryValue: "A1234567",
    }),
    { ok: false, error: "patient_secondary_verification_failed" },
  );
});

test("home and other collection locations require explicit location details", () => {
  assert.equal(collectionLocationError({ locationType: "BRANCH", locationText: null }), null);
  assert.equal(collectionLocationError({ locationType: "HOME", locationText: "" }), "collection_location_details_required");
  assert.equal(collectionLocationError({ locationType: "OTHER", locationText: "Corporate site" }), null);
  assert.equal(collectionLocationError({ locationType: "UNKNOWN", locationText: "x" }), "invalid_collection_location_type");
});

test("failed collection requires both a reason code and clinical/operational details", () => {
  assert.equal(failedCollectionReasonError({ reasonCode: null, reasonText: "No access" }), "failed_collection_reason_required");
  assert.equal(failedCollectionReasonError({ reasonCode: "NO_VENOUS_ACCESS", reasonText: "" }), "failed_collection_details_required");
  assert.equal(failedCollectionReasonError({ reasonCode: "NO_VENOUS_ACCESS", reasonText: "Two unsuccessful attempts" }), null);
});
