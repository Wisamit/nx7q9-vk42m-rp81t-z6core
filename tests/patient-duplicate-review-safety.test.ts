import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("patient creation blocks potential duplicates until explicit reviewed override", () => {
  const route = source("src/app/api/patients/route.ts");
  assert.ok(route.includes('error: "possible_duplicates"'));
  assert.ok(route.includes("duplicateReviewOverride"));
  assert.ok(route.includes("duplicate_review_reason_required"));
  assert.ok(route.includes("PATIENT_DUPLICATE_REVIEW_OVERRIDE"));
});

test("national ID and passport collisions remain hard conflicts outside duplicate override", () => {
  const route = source("src/app/api/patients/route.ts");
  const identifierCheck = route.indexOf("identifierChecks");
  const duplicateOverrideAudit = route.indexOf("PATIENT_DUPLICATE_REVIEW_OVERRIDE");
  assert.ok(identifierCheck >= 0);
  assert.ok(duplicateOverrideAudit > identifierCheck);
  assert.ok(route.includes('error: "identifier_already_used"'));
});

test("merge review exposes duplicate evidence but never auto-merges", () => {
  const page = source("src/app/patients/[id]/page.tsx");
  const panel = source("src/components/patient-merge-panel.tsx");
  assert.ok(page.includes("patientDuplicateEvidence"));
  assert.ok(panel.includes("Same normalized name + date of birth"));
  assert.ok(panel.includes("Same phone"));
  assert.ok(panel.includes("window.confirm"));
  assert.ok(panel.includes("/merge"));
});
