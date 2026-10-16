import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Issue #265: all high-impact clinical rule approvals and retirements use a guarded review modal",()=>{
 const ui=readFileSync("src/components/clinical-rule-governance-button.tsx","utf8");
 assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal";'));
 assert.ok(ui.includes('open={reviewAction!==null}'));
 assert.ok(ui.includes('size="compact"'));
 assert.ok(ui.includes('onSubmit={confirmReview}'));
 assert.ok(ui.includes("reviewAction === \"RETIRE\""));
 assert.ok(ui.includes('minLength={10} maxLength={1000} required'));
 assert.ok(ui.includes('const reason = reviewReason.trim();'));
 assert.ok(ui.includes('reason.length < 10 || reason.length > 1000'));
 assert.ok(ui.includes("if (busy || pending || !canApprove) return;"));
 assert.ok(ui.includes('lifecycle !== "DRAFT"'));
 assert.ok(ui.includes('lifecycle !== "APPROVED"'));
 assert.doesNotMatch(ui, /(?:window\.)?(?:confirm|prompt)\s*\(/);
});

test("Issue #265: existing action-bound independent staff step-up and server audit stay intact",()=>{
 const ui=readFileSync("src/components/clinical-rule-governance-button.tsx","utf8");
 const endpoint=readFileSync("src/app/api/clinical-rules/governance/route.ts","utf8");
 assert.ok(ui.includes("StaffStepUpDialog"));
 assert.ok(ui.includes('CLINICAL_RULE_RETIRE'));
 assert.ok(ui.includes('CLINICAL_RULE_APPROVE'));
 assert.ok(ui.includes('setPending({action:reviewAction,reason})'));
 assert.ok(ui.includes('if(pending)void submitWithProof(token,pending.action,pending.reason)'));
 assert.ok(ui.includes('"x-staff-step-up-token": token'));
 assert.ok(ui.includes('clinicalRuleProofResource(ruleType,id)'));
 assert.ok(ui.includes("Connection interrupted. Verify the rule status before retrying."));
 assert.ok(endpoint.includes('consumeStaffStepUp('));
 assert.ok(endpoint.includes('auditEvent.create'));
});
