import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("UI #265: duplicate identity review uses explicit guarded modal, not native confirm",()=>{
 const ui=readFileSync("src/components/patient-create-form.tsx","utf8");
 assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal";'));
 assert.ok(ui.includes("open={confirmSeparate && duplicateReview !== null}"));
 assert.ok(ui.includes('size="compact"'));
 assert.ok(ui.includes("duplicateReview.candidates.map"));
 assert.ok(ui.includes("candidate.evidence.map(evidenceLabel)"));
 assert.ok(ui.includes("createSeparateIdentity()"));
 assert.ok(ui.includes("minLength={10} maxLength={1000} required"));
 assert.ok(ui.includes("duplicateReason.trim().length < 10"));
 assert.ok(ui.includes("if (!duplicateReview || busy || !confirmSeparate) return;"));
 assert.doesNotMatch(ui,/window\.confirm\s*\(/);
 assert.ok(ui.includes("duplicateReviewOverride: Boolean(overrideReason)"));
 assert.ok(ui.includes("duplicateReviewReason: overrideReason || undefined"));
});

test("UI #265: patient creation network ambiguity must never force a blind duplicate retry",()=>{
 const ui=readFileSync("src/components/patient-create-form.tsx","utf8");
 assert.ok(ui.includes("catch {"));
 assert.ok(ui.includes("finally {"));
 assert.ok(ui.includes("Search patient records before retrying"));
 assert.ok(ui.includes("formRef.current?.reset()"),"form clears only after a confirmed patient creation");
 assert.ok(ui.includes("onSuccess?.(success)"));
 const api=readFileSync("src/app/api/patients/route.ts","utf8");
 assert.ok(api.includes('error: "possible_duplicates"'));
 assert.ok(api.includes('error: "identifier_already_used"'));
 assert.ok(api.includes("PATIENT_DUPLICATE_REVIEW_OVERRIDE"));
});
