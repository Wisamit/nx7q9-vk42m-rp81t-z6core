import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  patientCreationSubmissionKey, patientCreationPayloadHash,
  evaluatePatientCreationReplay,
} from "../src/lib/patient-creation-idempotency.ts";

test("patient creation request key is optional for legacy clients, but supplied keys must be UUIDs", () => {
  const key = randomUUID();
  assert.deepEqual(patientCreationSubmissionKey(null), { valid: true, key: null });
  assert.deepEqual(patientCreationSubmissionKey(key.toUpperCase()), { valid: true, key });
  for (const invalid of ["", "123", " ", "not-a-uuid", "00000000-0000-0000-0000-000000000000-extra"]) {
    assert.deepEqual(patientCreationSubmissionKey(invalid), { valid: false, key: null });
  }
});

test("patient fingerprint is deterministic on JSON field order but changes with demographics, identifiers or clinical override", () => {
  const basic = { fullNameEn: "Patient A", dateOfBirth: "1990-01-02",
    customIdentifiers: [{ schemeId: "x", value: "A01", issuingCountry: "AE" }],
    duplicateReviewOverride: false };
  const reversed = { duplicateReviewOverride: false,
    customIdentifiers: [{ issuingCountry: "AE", value: "A01", schemeId: "x" }],
    dateOfBirth: "1990-01-02", fullNameEn: "Patient A" };
  const fingerprint = patientCreationPayloadHash(basic);
  assert.match(fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(patientCreationPayloadHash(reversed), fingerprint);
  assert.notEqual(patientCreationPayloadHash({ ...basic, fullNameEn: "Patient B" }), fingerprint);
  assert.notEqual(patientCreationPayloadHash({ ...basic, duplicateReviewOverride: true }), fingerprint);
  assert.notEqual(patientCreationPayloadHash({ ...basic, customIdentifiers: [] }), fingerprint);
  assert.ok(!fingerprint.includes("Patient"));
});

test("replay can only confirm exact same still-active, unmerged identity", () => {
  const hash = patientCreationPayloadHash({ fullNameEn: "Patient A" });
  const previous = { id: randomUUID(), status: "ACTIVE", mergedIntoPatientId: null,
    creationPayloadHash: hash };
  assert.deepEqual(evaluatePatientCreationReplay(null, hash), { kind: "new" });
  assert.deepEqual(evaluatePatientCreationReplay(previous, hash), {
    kind: "replay", id: previous.id,
  });
  assert.deepEqual(evaluatePatientCreationReplay({ ...previous, creationPayloadHash: "0".repeat(64) }, hash),
    { kind: "conflict" });
  assert.deepEqual(evaluatePatientCreationReplay({ ...previous, creationPayloadHash: null }, hash),
    { kind: "conflict" });
  assert.deepEqual(evaluatePatientCreationReplay({ ...previous, mergedIntoPatientId: randomUUID() }, hash),
    { kind: "record_changed" });
  assert.deepEqual(evaluatePatientCreationReplay({ ...previous, status: "INACTIVE" }, hash),
    { kind: "record_changed" });
});

test("real patient route replays before duplicate check; a keyed creation is atomic with identifiers/audit", () => {
  const api = readFileSync("src/app/api/patients/route.ts", "utf8");
  const form = readFileSync("src/components/patient-create-form.tsx", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20261018215000_patient_registration_submission_idempotency/migration.sql", "utf8");
  assert.ok(api.includes('requirePermission("patients.manage")'));
  assert.ok(api.includes('request.headers.get("x-family-lab-patient-key")'));
  assert.ok(api.includes("organizationId: session.user.organizationId,"));
  assert.ok(api.includes("creationRequestUserId: session.user.id,"));
  assert.ok(api.includes("creationSubmissionKey: submission.key,"));
  assert.ok(api.includes("creationPayloadHash: payloadHash,"));
  assert.ok(api.indexOf("const replay = await replayResponse()") <
    api.indexOf("const duplicateRows ="), "replay must precede potentially misleading duplicate candidates");
  assert.ok(api.includes('if (error && typeof error === "object" && "code" in error && error.code === "P2002")'));
  assert.ok(api.includes('PATIENT_DUPLICATE_REVIEW_OVERRIDE'));
  assert.ok(api.includes('tx.patientIdentifier.createMany'));
  assert.ok(api.includes('tx.auditEvent.create'));
  assert.ok(form.includes('creationKey.current ??= crypto.randomUUID()'));
  assert.ok(form.includes('"x-family-lab-patient-key": creationKey.current!'));
  assert.ok(form.includes('creationKey.current = null;'));
  assert.ok(form.includes("inFlight.current = true;"));
  assert.ok(schema.includes("@@unique([organizationId, creationRequestUserId, creationSubmissionKey]"));
  assert.ok(migration.includes("ADD UNIQUE INDEX `patient_creation_request_key_uq`"));
  assert.ok(migration.includes("FOREIGN KEY (`creation_request_user_id`) REFERENCES `users`(`id`)"));
});
