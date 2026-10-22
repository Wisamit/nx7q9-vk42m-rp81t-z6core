import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const src=(file:string)=>readFileSync(file,"utf8");

test("F5: technical, QC and delta consent is explicit, sequential and modal (not window.confirm)",()=>{
  const c=src("src/components/result-entry-form.tsx");
  assert.match(c,/<CrudModal\s+[\s\S]*?open=\{reviewPrompt !== null\}/);
  assert.match(c,/size="compact"/);
  assert.match(c,/protectUnsavedChanges=\{false\}/);
  assert.match(c,/if \(!savedResultId \|\| busy !== "" \|\| reviewResolver\.current \|\| saveUncertainRef\.current\) return;/);
  assert.match(c,/if \(!await askReview\(tr\("Complete technical review/);
  assert.match(c,/qc_warning_confirmation_required/);
  assert.match(c,/delta_review_confirmation_required/);
  assert.equal((c.match(/const confirmed = await askReview\(tr\(/g)||[]).length,2);
  assert.match(c,/if \(!confirmed\) \{ cancelledAfterServerChallenge = true; break; \}/);
  assert.match(c,/if \(cancelledAfterServerChallenge\)/);
  assert.match(c,/reviewResolver\.current = null;/);
  assert.match(c,/outstanding\?\.\(false\)/);
  assert.match(c,/onClose=\{\(\) => resolveReview\(false\)\}/);
  assert.match(c,/type="button" className="secondary-button" onClick=\{\(\) => resolveReview\(false\)\}/);
  assert.match(c,/type="button" className="primary-button" onClick=\{\(\) => resolveReview\(true\)\}/);
  assert.doesNotMatch(c,/\b(?:window\.)?confirm\s*\(/);
});

test("F5: warning confirmation flags are false by default and only true after explicit response",()=>{
  const c=src("src/components/result-entry-form.tsx");
  const verify=c.slice(c.indexOf("  async function verify()"),c.indexOf("  const statusLocked"));
  assert.ok(verify.length>1000);
  assert.match(verify,/let confirmDeltaWarnings = false;/);
  assert.match(verify,/let confirmQcWarnings = false;/);
  assert.match(verify,/body: JSON\.stringify\(\{ confirmDeltaWarnings, confirmQcWarnings \}\)/);
  assert.ok(verify.indexOf("const confirmed = await askReview")<verify.indexOf("confirmQcWarnings = true;"));
  assert.ok(verify.lastIndexOf("const confirmed = await askReview")<verify.indexOf("confirmDeltaWarnings = true;"));
  assert.match(verify,/if \(!confirmed\) \{ cancelledAfterServerChallenge = true; break; \}/);
  assert.match(verify,/setBusy\("verify"\);/);
  assert.match(verify,/if \(!await askReview\(tr\(/);
});

test("F5: compact dialog focus trapping and independent clinical server review policies remain in place",()=>{
  const ui=src("src/components/crud-modal.tsx");
  const stepUp=src("src/components/staff-step-up-dialog.tsx");
  const clinical=src("src/app/api/results/[id]/verify/route.ts");
  assert.match(ui,/aria-modal="true"/);
  assert.match(ui,/event\.key === "Escape"/);
  assert.match(ui,/focusin/);
  assert.match(ui,/previouslyFocused/);
  assert.match(stepUp,/size="compact"/);
  assert.match(stepUp,/password,totp/);
  assert.match(clinical,/qc_warning_confirmation_required/);
  assert.match(clinical,/delta_review_confirmation_required/);
  assert.match(clinical,/confirmDeltaWarnings/);
  assert.match(clinical,/confirmQcWarnings/);
});

test("F5: review file staging has no browser-native confirm false positive",()=>{
  const c=src("src/components/review-file-upload-dialog.tsx");
  assert.match(c,/async function stageSelectedFile\(\)/);
  assert.match(c,/void stageSelectedFile\(\)/);
  assert.doesNotMatch(c,/\bconfirm\s*\(/);
  assert.match(c,/retryBlocked/);
  assert.match(c,/protectUnsavedChanges/);
});
