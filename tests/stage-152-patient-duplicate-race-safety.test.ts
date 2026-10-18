import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  patientReviewedCandidateIds, patientCandidateReviewIsCurrent,
  PATIENT_DUPLICATE_REVIEW_MAX_CANDIDATES,
} from "../src/lib/patient-registration-review-guard.ts";

test("clinical override accepts only exact, unique patient UUID identities", () => {
  const a = randomUUID(), b = randomUUID();
  assert.deepEqual(patientReviewedCandidateIds([a.toUpperCase(), b]), [a, b]);
  for (const value of [undefined, null, {}, ["x"], [a, a], [a, 2],
    Array.from({ length: 11 }, () => randomUUID())])
    assert.equal(patientReviewedCandidateIds(value), null);
  assert.equal(PATIENT_DUPLICATE_REVIEW_MAX_CANDIDATES, 10);
  assert.equal(patientCandidateReviewIsCurrent([a, b], [b, a]), true);
  assert.equal(patientCandidateReviewIsCurrent([a], [a, b]), false);
  assert.equal(patientCandidateReviewIsCurrent([a, b], [a]), false);
  assert.equal(patientCandidateReviewIsCurrent([a, a], [a, b]), false);
  assert.equal(patientCandidateReviewIsCurrent(null, [a]), false);
});

test("patient POST locks same active organization BEFORE fresh duplicate evidence and any write", () => {
  const route = readFileSync("src/app/api/patients/route.ts", "utf8");
  const form = readFileSync("src/components/patient-create-form.tsx", "utf8");
  const start = route.indexOf("outcome = await prisma.$transaction(async (tx) =>");
  const lock = route.indexOf("SELECT id FROM organizations", start);
  const candidates = route.indexOf("const duplicateRows =", lock);
  const initialWrite = route.indexOf("const patient = await tx.patient.create", candidates);
  assert.ok(start >= 0 && lock > start && candidates > lock && initialWrite > candidates);
  assert.ok(route.includes("FOR UPDATE"));
  assert.ok(route.includes("status = 'ACTIVE'"));
  assert.ok(route.includes("tx.patient.findMany({"));
  assert.ok(route.includes("take: PATIENT_DUPLICATE_REVIEW_MAX_CANDIDATES + 1"));
  assert.ok(route.includes('kind: "duplicate_overflow"'));
  assert.ok(route.includes("patientCandidateReviewIsCurrent(reviewedCandidateIds"));
  assert.ok(route.includes('kind: "duplicate_review_candidates_changed"'));
  assert.ok(route.includes("tx.patientIdentifier.findUnique({"));
  assert.ok(route.includes("PATIENT_DUPLICATE_REVIEW_OVERRIDE"));
  assert.ok(route.includes("reviewedCandidateIds: overrideReason ? reviewedCandidateIds : undefined"));
  assert.ok(form.includes("duplicateReview.candidates.map(candidate => candidate.id)"));
  assert.ok(form.includes('body.error === "duplicate_review_candidates_changed"'));
  assert.ok(form.includes("setDuplicateReview(null)"));
  // Stage151 idempotent replay survives the new organization-scoped lock;
  // a concurrent identical request cannot appear as an unreviewed duplicate.
  const lockedReplay = route.indexOf("const decision = evaluatePatientCreationReplay", lock);
  assert.ok(lockedReplay > lock && lockedReplay < candidates);
  assert.ok(route.includes('kind: "replayed"'));
  assert.ok(route.includes('kind: "replay_conflict"'));
  assert.ok(route.includes('kind: "replay_record_changed"'));
  // Defer actual JSON response until transaction has finished.
  assert.ok(route.indexOf('if (outcome.kind === "possible_duplicates")') > initialWrite);
});
