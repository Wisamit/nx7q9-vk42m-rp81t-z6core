import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  patientReviewedCandidateIds, patientCandidateReviewIsCurrent,
} from "../src/lib/patient-registration-review-guard.ts";

test("Stage 153: patient edits share tenant lock with registration before duplicate search and write", () => {
  const route = readFileSync("src/app/api/patients/[id]/route.ts", "utf8");
  const create = readFileSync("src/app/api/patients/route.ts", "utf8");
  const ui = readFileSync("src/components/patient-edit-form.tsx", "utf8");
  const start = route.indexOf("const outcome = await prisma.$transaction(async tx => {");
  const lock = route.indexOf("SELECT id FROM organizations", start);
  const latest = route.indexOf("const currentPatient = await tx.patient.findFirst({", lock);
  const duplicate = route.indexOf("const duplicateRows = duplicateOr.length > 0", latest);
  const decision = route.indexOf("patientCandidateReviewIsCurrent(", duplicate);
  const write = route.indexOf("const changed = await tx.patient.updateMany({", decision);
  const audit = route.indexOf('action: "PATIENT_UPDATED"', write);
  assert.ok(start >= 0 && lock > start && latest > lock && duplicate > latest &&
    decision > duplicate && write > decision && audit > write);
  assert.equal(route.slice(start, lock).includes("await prisma.patient.findMany"), false);
  assert.ok(route.includes("FOR UPDATE"));
  assert.ok(route.includes("status = 'ACTIVE'"));
  assert.ok(create.includes("SELECT id FROM organizations"));
  assert.ok(route.includes("take: PATIENT_DUPLICATE_REVIEW_MAX_CANDIDATES + 1"));
  assert.ok(route.includes('kind: "duplicate_review_overflow"'));
  assert.ok(route.includes('kind: "duplicate_review_candidates_changed"'));
  assert.ok(route.includes("updatedAt: expectedUpdatedAt"));
  assert.ok(route.includes('PATIENT_DUPLICATE_REVIEW_OVERRIDE'));
  assert.ok(route.includes('if (outcome.kind === "possible_duplicates")'));
  assert.ok(route.includes("reviewedCandidateIds: duplicateCandidates.map(candidate => candidate.id)"));
  assert.ok(ui.includes("reviewedCandidateIds: overrideReason ? reviewedCandidateIds : undefined"));
  assert.ok(ui.includes("duplicateReview.candidates.map(candidate => candidate.id)"));
  assert.ok(ui.includes("setDuplicateReview(null)"));
  assert.ok(ui.includes("duplicate_review_candidates_changed"));
  assert.ok(ui.includes("duplicate_review_overflow"));
});

test("Stage 153: only precisely reviewed unique IDs can authorize subsequent master editing", () => {
  const ids = [randomUUID(), randomUUID()];
  const reviewed = patientReviewedCandidateIds([ids[1], ids[0]]);
  assert.ok(reviewed);
  assert.equal(patientCandidateReviewIsCurrent(reviewed, ids), true);
  assert.equal(patientCandidateReviewIsCurrent(reviewed, [ids[0]]), false);
  assert.equal(patientCandidateReviewIsCurrent(reviewed, [...ids, randomUUID()]), false);
  assert.equal(patientCandidateReviewIsCurrent(reviewed, []), false);
  assert.equal(patientCandidateReviewIsCurrent([], ids), false);
  assert.equal(patientCandidateReviewIsCurrent(null, ids), false);
});
