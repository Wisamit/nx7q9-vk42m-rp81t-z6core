import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(path:string)=>readFileSync(path,"utf8");

test("UI #265: canonical patient merge requires source/survivor review and documented reason before step-up",()=>{
  const ui=read("src/components/patient-merge-panel.tsx");
  assert.equal((ui.match(/<CrudModal\b/g)||[]).length,1);
  assert.equal((ui.match(/<StaffStepUpDialog\b/g)||[]).length,1);
  assert.ok(ui.includes('open={review!==null}'));
  assert.ok(ui.includes('onSubmit={confirmMergeReview}'));
  assert.ok(ui.includes('source.patientNumber'));
  assert.ok(ui.includes('target.patientNumber'));
  assert.ok(ui.includes('source.hasPortalAccount && target.hasPortalAccount'));
  assert.ok(ui.includes('source.id===target.id'));
  assert.ok(ui.includes('setPendingMerge({source,target,reason:reason.trim()})'));
  assert.ok(ui.includes('reason.trim()'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('role="alert"'));
  assert.doesNotMatch(ui,/(?:window\.)?(?:prompt|confirm)\s*\(/);
});

test("UI #265: patient merge remains bound to action/resource/branch staff step-up and tenant-scoped API",()=>{
  const ui=read("src/components/patient-merge-panel.tsx");
  assert.ok(ui.includes('action="PATIENT_MERGE"'));
  assert.ok(ui.includes('[pendingMerge.source.id, pendingMerge.target.id].join(":")'));
  assert.ok(ui.includes('branchId={activeBranchId}'));
  assert.ok(ui.includes('"x-staff-step-up-token": stepUpToken'));
  assert.ok(ui.includes('targetPatientId: target.id, reason'));
  assert.ok(ui.includes('if (busy) return;'));
  assert.ok(ui.includes('finally {'));
  const api=read("src/app/api/patients/[id]/merge/route.ts");
  assert.ok(api.includes('consumeStaffStepUp'));
  assert.ok(api.includes('"PATIENT_MERGE"'));
  assert.ok(api.includes('organizationId'));
  assert.ok(api.includes('sourceIdentitySnapshot'));
  assert.ok(api.includes('targetIdentitySnapshot'));
  assert.ok(api.includes('auditEvent'));
});
