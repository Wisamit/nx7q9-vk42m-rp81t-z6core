import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  discountApprovalFingerprint,
} from "../src/lib/discount-approval.ts";
import {
  approverCanAuthorize, discountApprovalMode, effectiveDiscountLimit,
} from "../src/lib/discount-policy.ts";
import {parseSendOutCost} from "../src/lib/sendout-cost.ts";
import {
  reportTemplateApprovalError,reportTemplateActivationError,
  immediateReportTemplateActivationOnly,
} from "../src/lib/report-template-governance.ts";

const file=(p:string)=>readFileSync(p,"utf8");

test("§9 calculated clinical results require governed drafts, exact dependencies and zero-division rejection",()=>{
  const formula=file("src/lib/formula-engine.ts");
  const calculated=file("src/app/api/clinical-rules/calculated/route.ts");
  const governance=file("src/app/api/clinical-rules/governance/route.ts");
  assert.match(formula,/export function evaluateFormula\(/);
  assert.match(formula,/export function formulaVariables\(/);
  assert.match(formula,/MISSING_FORMULA_INPUT/);
  assert.match(formula,/FORMULA_DIVISION_BY_ZERO/);
  assert.match(formula,/FORMULA_NON_FINITE_RESULT/);
  assert.match(formula,/new Prisma\.Decimal/);
  assert.match(calculated,/status:\s*"INACTIVE"/);
  assert.match(governance,/requirePermission\("clinical_rules\.approve"\)/);
});

test("§18 manager discount: context fingerprint binds tenant, branch, amount, tariff revisions and tax",()=>{
  const base={
    organizationId:"test-tenant",branchId:"branch-a",patientId:"synthetic-patient",
    sourceId:"source-a",referrerId:null,clientId:null,directTestIds:["B","A"],
    packageIds:[],discountPercent:"12.50",discountReason:"F6 synthetic",currency:"AED",
    pricing:[{kind:"TEST" as const,id:"A",priceReferenceId:"revision-1",unitPrice:"13.0001"},
      {kind:"TEST" as const,id:"B",priceReferenceId:"revision-2",unitPrice:"9.0000"}],
    tax:[{kind:"TEST" as const,id:"A",ruleId:"tax-version",ratePercent:"0.0000",
      treatment:"EXEMPT",priceMode:"EXCLUSIVE",taxAmount:"0.0000"}],
  };
  const root=discountApprovalFingerprint(base);
  assert.equal(root,discountApprovalFingerprint({...base,
    directTestIds:["A","B"],pricing:[...base.pricing].reverse()}));
  for(const variant of [
    {...base,organizationId:"foreign"},
    {...base,branchId:"branch-b"},
    {...base,patientId:"other"},
    {...base,currency:"USD"},
    {...base,discountPercent:"20.00"},
    {...base,pricing:[{...base.pricing[0],unitPrice:"13.0002"},base.pricing[1]]},
    {...base,pricing:[{...base.pricing[0],priceReferenceId:"revision-3"},base.pricing[1]]},
    {...base,tax:[{...base.tax[0],ruleId:"different-tax-version"}]},
  ])assert.notEqual(root,discountApprovalFingerprint(variant));
  assert.equal(effectiveDiscountLimit({userOverride:null,roleLimits:["12","20"]}),20);
  assert.equal(discountApprovalMode({requestedPercent:21,requesterLimitPercent:20}),"APPROVAL_WORKFLOW");
  assert.equal(discountApprovalMode({requestedPercent:-1,requesterLimitPercent:20}),"INVALID");
  assert.equal(approverCanAuthorize({requestedPercent:21,approverLimitPercent:20,
    hasApprovalPermission:true,branchAllowed:true}),false);
  assert.equal(approverCanAuthorize({requestedPercent:10,approverLimitPercent:20,
    hasApprovalPermission:true,branchAllowed:false}),false);
});

test("§29 external lab/send-out requires exact currency-coupled cost, order and specimen custody locks",()=>{
  assert.deepEqual(parseSendOutCost(undefined,undefined),{kind:"ok",amount:null,currency:null});
  assert.deepEqual(parseSendOutCost("12345678901234.9999","AED"),
    {kind:"ok",amount:"12345678901234.9999",currency:"AED"});
  for(const [amount,currency] of [
    ["1.00001","AED"],["1e3","AED"],["-2","AED"],["10.00",null],
    [null,"AED"],["100000000000000.0","AED"],["2.00","INVALID"],
  ])assert.equal(parseSendOutCost(amount,currency).kind,"invalid");
  const route=file("src/app/api/send-outs/route.ts");
  const itemLock=route.indexOf("SELECT id FROM order_items");
  const freshItem=route.indexOf("const currentItem =",itemLock);
  const duplicate=route.indexOf("const active =",freshItem);
  const specimenLock=route.indexOf("SELECT id FROM specimens",duplicate);
  const referral=route.indexOf("tx.sendOutReferral.create",specimenLock);
  assert.ok(itemLock>=0&&freshItem>itemLock&&duplicate>freshItem&&specimenLock>duplicate&&referral>specimenLock);
  assert.match(route,/organizationId: session\.user\.organizationId/);
  assert.match(route,/canAccessBranch\(session, orderItem\.order\.orderingBranchId\)/);
  assert.match(route,/specimen_not_linked_to_order_item/);
});

test("§72 global search has organization and permission gates, branch-scoped clinical and financial results",()=>{
  const search=file("src/app/search/page.tsx");
  assert.match(search,/requireSession\(\)/);
  assert.match(search,/permissionSet\(session\)/);
  assert.match(search,/session\.user\.organizationId/);
  assert.match(search,/session\.user\.branchScopes\.map/);
  for(const permission of ["patients.view","orders.view","specimens.view","billing.view","referrers.view"])
    assert.ok(search.includes('permissions.has("'+permission+'")'),permission);
  assert.match(search,/orderingBranchId: \{ in: branchIds \}/);
  assert.match(search,/branchId: \{ in: branchIds \}/);
  assert.match(search,/currentBranchId: \{ in: branchIds \}/);
  assert.match(search,/organizationId: orgId/g);
  assert.match(search,/take: 20/g);
  assert.match(search,/\.trim\(\)\.slice\(0, 120\)/);
  assert.doesNotMatch(search,/prisma\.\$queryRawUnsafe/);
});

test("§81 report designer requires independent signed version approval and time-bounded immutable template resolution",()=>{
  const draft={
    status:"DRAFT" as const,submittedByUserId:"creator",approvedByUserId:null,
    approvedAt:null,effectiveFrom:null,effectiveTo:null,retiredAt:null,
  };
  const time=new Date("2026-10-22T00:00:00.000Z");
  assert.equal(reportTemplateApprovalError(draft,"creator"),"template_self_approval_forbidden");
  assert.equal(reportTemplateApprovalError(draft,"independent-reviewer"),null);
  const approved={...draft,status:"APPROVED" as const,
    approvedByUserId:"independent-reviewer",approvedAt:time};
  assert.equal(reportTemplateActivationError(approved,"publisher"),null);
  assert.equal(reportTemplateActivationError({...approved,approvedByUserId:"creator"},"publisher"),
    "template_version_approval_invalid");
  assert.equal(immediateReportTemplateActivationOnly({}),true);
  for(const payload of [{effectiveFrom:"2020-01-01"},{effectiveFrom:"2099-01-01"},null])
    assert.equal(immediateReportTemplateActivationOnly(payload),false);
  const activation=file("src/app/api/report-templates/[id]/versions/[versionId]/activate/route.ts");
  const resolver=file("src/lib/report-template.ts");
  assert.match(activation,/FOR UPDATE/);
  assert.match(activation,/reportTemplateEditorIsLive/);
  assert.match(activation,/status: "RETIRED", effectiveTo: now, retiredAt: now/);
  assert.match(resolver,/effectiveFrom: \{ lte: input\.asOf \}/);
  assert.match(resolver,/effectiveTo: \{ gt: input\.asOf \}/);
});
