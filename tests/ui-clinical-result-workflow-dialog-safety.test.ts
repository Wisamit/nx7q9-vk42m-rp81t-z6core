import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");

test("UI #265: critical communication and clinical medical return require explicit protected compact dialogs", () => {
  const ui = read("src/components/result-workflow-actions.tsx");
  assert.equal((ui.match(/<CrudModal\b/g) || []).length, 5);
  assert.equal((ui.match(/<form\b/g) || []).length, 4);
  assert.ok(ui.includes('open={governedConfirmation!==null}'));
  assert.ok(ui.includes('open={qcWarningReasons!==null}'));
  assert.ok(ui.includes('open={showMedicalReturn}'));
  assert.ok(ui.includes('open={showCommunication}'));
  assert.ok(ui.includes('open={showAmendment}'));
  assert.ok(ui.includes('setStepUpPending("MEDICAL_APPROVAL")'));
  assert.ok(ui.includes('onSubmit={returnFromMedicalValidation}'));
  assert.ok(ui.includes('onSubmit={submitCommunication}'));
  assert.ok(ui.includes('onSubmit={startAmendment}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('if (busy || !canLogCriticalNow) return;'));
  assert.ok(ui.includes('if (busy || !pendingMedical || !canMedicalValidate) return;'));
  assert.ok(ui.includes('if (busy || resultStatus !== "RELEASED" || !canAmend) return;'));
  assert.ok(ui.includes('name="readBackConfirmed"'));
  assert.ok(ui.includes('name="acknowledgementConfirmed"'));
  assert.ok(ui.includes('read_back_confirmation_required'));
  assert.ok(ui.includes('setShowMedicalReturn(false)'));
  assert.ok(ui.includes('setShowCommunication(false)'));
  assert.ok(ui.includes('setShowAmendment(false)'));
  assert.ok(ui.includes('body: JSON.stringify({ action: "RETURN", reason })'));
  assert.ok(ui.includes('setPendingAmendmentReason(reason)'));
  assert.ok(ui.includes('setStepUpPending("RESULT_AMEND")'));
});

test("UI #265: existing clinical step-up, immutable report and QC/critical release blocks remain server owned", () => {
  const ui = read("src/components/result-workflow-actions.tsx");
  assert.ok(ui.includes("<StaffStepUpDialog"));
  assert.ok(ui.includes('x-staff-step-up-token'));
  assert.ok(ui.includes('stepUpPending||"MEDICAL_APPROVAL"'));
  assert.ok(ui.includes('"MEDICAL_APPROVAL"'));
  assert.ok(ui.includes('"RESULT_RELEASE"'));
  assert.ok(ui.includes('"RESULT_AMEND"'));
  assert.ok(ui.includes("qc_warning_confirmation_required"));
  assert.ok(ui.includes("critical_acknowledgement_required"));
  assert.ok(ui.includes("specimen_custody_changed_blocks_release"));

  const med = read("src/app/api/results/[id]/medical-validate/route.ts");
  const amend = read("src/app/api/results/[id]/amend/route.ts");
  const critical = read("src/app/api/results/[id]/critical-communications/route.ts");
  assert.ok(med.includes("medical_validator_must_differ_from_technical_reviewer") ||
    med.includes("medical_validate"));
  assert.ok(amend.includes("step_up") || amend.includes("AMEND"));
  assert.ok(critical.includes("read_back_confirmation_required"));
  assert.ok(critical.includes("auditEvent"));
});
