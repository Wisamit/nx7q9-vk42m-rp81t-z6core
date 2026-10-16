import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Issue #265: diagnostic release and medical approval use qualified modal review plus fresh step-up",()=>{
 const ui=readFileSync("src/components/result-workflow-actions.tsx","utf8");
 assert.ok(ui.includes('open={governedConfirmation!==null}'));
 assert.ok(ui.includes('open={qcWarningReasons!==null}'));
 assert.ok(ui.includes('size="compact"'));
 assert.ok(ui.includes('setStepUpPending(governedConfirmation)'));
 assert.ok(ui.includes('setStepUpPending("MEDICAL_APPROVAL")'));
 assert.ok(ui.includes("StaffStepUpDialog"));
 assert.ok(ui.includes('"x-staff-step-up-token":stepUpToken'));
 assert.ok(ui.includes('confirmQcWarnings:qcReviewConfirmed'));
 assert.ok(ui.includes('qc_warning_confirmation_required'));
 assert.ok(ui.includes('setQcReviewConfirmed(true)'));
 assert.ok(ui.includes('setQcReviewConfirmed(false)'));
 assert.ok(ui.includes('setQcWarningReasons(null)'));
 assert.ok(ui.includes('setQcAcknowledgement(false)'));
 assert.ok(ui.includes("new independent staff verification"));
 assert.doesNotMatch(ui,/(?:window\.)?(?:confirm|prompt)\s*\(/);
});

test("Issue #265: all technical, QC, custody and critical communication release stops remain enforced",()=>{
 const ui=readFileSync("src/components/result-workflow-actions.tsx","utf8");
 for(const term of [
   "medical_validator_must_differ_from_technical_reviewer",
   "technical_review_evidence_missing",
   "medical_validation_policy_snapshot_invalid",
   "validation_hold_review_required",
   "qc_blocking_hold",
   "critical_acknowledgement_required",
   "specimen_custody_changed_blocks_release",
   "Connection interrupted. Check published report versions before retrying release.",
 ])assert.ok(ui.includes(term),"Lost clinical release restriction: "+term);
 assert.ok(ui.includes('validationStage!=="MEDICAL_VALIDATION"'));
 assert.ok(ui.includes('validationStage!=="COMPLETE"'));
 assert.ok(ui.includes("resultStatus!==\"VERIFIED\""));
 const server=readFileSync("src/app/api/results/[id]/release/route.ts","utf8");
 assert.ok(server.includes("consumeStaffStepUp"));
 assert.ok(server.includes("buildDiagnosticReportSnapshot"));
 assert.ok(server.includes("qc"));
});
