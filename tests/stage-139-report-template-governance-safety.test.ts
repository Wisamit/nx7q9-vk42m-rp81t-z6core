import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  immediateReportTemplateActivationOnly, reportTemplateActivationError,
  reportTemplateApprovalError, type ReportTemplateTransition,
} from "../src/lib/report-template-governance.ts";

const id="creator",reviewer="reviewer",now=new Date("2026-10-15T12:00:00.000Z");
const draft:ReportTemplateTransition={status:"DRAFT",submittedByUserId:id,
  approvedByUserId:null,approvedAt:null,effectiveFrom:null,effectiveTo:null,retiredAt:null};
test("Stage 139: independent approval requires draft, cannot self-approve, activation requires approved provenance",()=>{
  assert.equal(reportTemplateApprovalError(draft,id),"template_self_approval_forbidden");
  assert.equal(reportTemplateApprovalError(draft,reviewer),null);
  assert.equal(reportTemplateActivationError(draft,reviewer),"template_version_not_approved");
  const approved={...draft,status:"APPROVED" as const,approvedByUserId:reviewer,approvedAt:now};
  assert.equal(reportTemplateApprovalError(approved,reviewer),"template_version_not_draft");
  assert.equal(reportTemplateActivationError(approved,reviewer),null);
  for(const changed of [
    {...approved,approvedByUserId:id},
    {...approved,approvedAt:null},
    {...approved,effectiveFrom:now},
    {...approved,retiredAt:now},
  ]) assert.equal(reportTemplateActivationError(changed,reviewer),"template_version_approval_invalid");
});
test("Stage 139: no backdating, future scheduling, status-only retroactive erasure or unsigned activation",()=>{
  assert.equal(immediateReportTemplateActivationOnly({}),true);
  for(const data of [null,[],{effectiveFrom:"2020-01-01"},{effectiveFrom:"2099-01-01"},{unsafe:true}])
    assert.equal(immediateReportTemplateActivationOnly(data),false);
  const activation=readFileSync("src/app/api/report-templates/[id]/versions/[versionId]/activate/route.ts","utf8");
  const approval=readFileSync("src/app/api/report-templates/[id]/versions/[versionId]/approve/route.ts","utf8");
  const resolver=readFileSync("src/lib/report-template.ts","utf8");
  for(const source of [approval,activation]){
    assert.match(source,/SELECT id FROM report_templates[\s\S]*?FOR UPDATE/);
    assert.match(source,/reportTemplateEditorIsLive/);
    assert.match(source,/isolationLevel: "Serializable"/);
    assert.match(source,/updateMany/);
    assert.match(source,/await tx.auditEvent.create/);
  }
  assert.match(approval,/APPROVE_EXACT_REPORT_LAYOUT_VERSION/);
  assert.match(approval,/reportTemplateApprovalError/);
  assert.match(activation,/immediateReportTemplateActivationOnly/);
  assert.match(activation,/reportTemplateActivationError/);
  assert.match(activation,/effectiveFrom: \{ lt: now \}/);
  assert.match(activation,/status: "RETIRED", effectiveTo: now, retiredAt: now/);
  assert.match(resolver,/status: \{ in: \["EFFECTIVE", "RETIRED"\] \}/);
  assert.match(resolver,/effectiveFrom: \{ lte: input.asOf \}/);
  assert.match(resolver,/effectiveTo: \{ gt: input.asOf \}/);
  assert.doesNotMatch(activation,/approvedByUserId:session.user.id/);
  const ui=readFileSync("src/components/report-template-manager.tsx","utf8");
  assert.match(ui,/latestSubmittedByUserId!==currentUserId/);
  assert.match(ui,/APPROVE_EXACT_REPORT_LAYOUT_VERSION/);
  assert.match(ui,/latestStatus==="APPROVED"/);
});
