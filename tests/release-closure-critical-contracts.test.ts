import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { discountApprovalFingerprint } from "../src/lib/discount-approval.ts";
import { parseSendOutCost } from "../src/lib/sendout-cost.ts";

test("Formula evaluation source retains decimal arithmetic, zero-division and missing-input safeguards", () => {
  const src=readFileSync("src/lib/formula-engine.ts","utf8");
  assert.ok(src.includes("new Prisma.Decimal(token.value)"));
  assert.ok(src.includes("new Prisma.Decimal(value)"));
  assert.ok(src.includes('rhs.eq(0)'));
  assert.ok(src.includes("FORMULA_DIVISION_BY_ZERO"));
  assert.ok(src.includes("MISSING_FORMULA_INPUT:"));
  assert.ok(src.includes("TRAILING_FORMULA_TOKEN"));
  assert.ok(src.includes("FORMULA_NON_FINITE_RESULT"));
});

test("Discount approval fingerprint binds tenant/branch/prices and tax without item-order dependence", () => {
  const base = {
    organizationId:"org",branchId:"branch",patientId:"patient",sourceId:"source",
    referrerId:null,clientId:"client",directTestIds:["T2","T1"],
    packageIds:["P1"],discountPercent:"10.0000",discountReason:" authorized ",
    currency:"AED",pricing:[
      {kind:"TEST" as const,id:"T2",priceReferenceId:"pr2",unitPrice:"7.0000"},
      {kind:"TEST" as const,id:"T1",priceReferenceId:"pr1",unitPrice:"5.0000"},
    ],
    tax:[{kind:"TEST" as const,id:"T1",ruleId:"tax",ratePercent:"5.0000",
      treatment:"STANDARD",priceMode:"EXCLUSIVE",taxAmount:"0.2500"}],
  };
  const key = discountApprovalFingerprint(base);
  assert.equal(key, discountApprovalFingerprint({
    ...base,directTestIds:[...base.directTestIds].reverse(),pricing:[...base.pricing].reverse(),
  }));
  assert.notEqual(key,discountApprovalFingerprint({...base,branchId:"another"}));
  assert.notEqual(key,discountApprovalFingerprint({...base,
    pricing:[{...base.pricing[0],unitPrice:"8.0000"},base.pricing[1]]}));
  assert.notEqual(key,discountApprovalFingerprint({...base,
    tax:[{...base.tax[0],ratePercent:"6.0000"}]}));
});

test("Report template source retains branch effective-date version and branding safety", () => {
  const src=readFileSync("src/lib/report-template.ts","utf8");
  assert.ok(src.includes('status: { in: ["EFFECTIVE", "RETIRED"] }'));
  assert.ok(src.includes("effectiveFrom: { lte: input.asOf }"));
  assert.ok(src.includes("branchId: input.branchId"));
  assert.ok(src.includes("INVALID_LOGO_URL"));
  assert.ok(src.includes("normalizeReportTemplateConfiguration(version.configuration)"));
});

test("Send-out cost uses exact DECIMAL(18,4), never floating-point rounding", () => {
  for(const [amount,currency,expected] of [
    ["0.1000","AED","0.1000"],["1.005","aed","1.005"],
    ["12345678901234.9999","USD","12345678901234.9999"],
    [0,"AED","0"],
  ] as const) {
    assert.deepEqual(parseSendOutCost(amount,currency),
      {kind:"ok",amount:expected,currency:currency.toUpperCase()});
  }
  assert.deepEqual(parseSendOutCost(null,null),{kind:"ok",amount:null,currency:null});
  for(const [amount,currency] of [
    ["0.10001","AED"],["1e3","AED"],["-1","AED"],["1.00000","AED"],
    ["123456789012345","AED"],["1",""],["","AED"],[1.23456,"AED"],
    ["NaN","USD"],[{},"AED"],["1","AEDS"],
  ] as const)assert.deepEqual(parseSendOutCost(amount,currency),{kind:"invalid"});
  const route=readFileSync("src/app/api/send-outs/route.ts","utf8");
  assert.ok(route.includes('new Prisma.Decimal(cost.amount).toFixed(4)'));
  assert.ok(!route.includes("Number(costText)") && !route.includes("costAmount.toFixed(4)"));
  assert.ok(route.includes("costAmount: referral.costAmount?.toString()"));
  assert.ok(route.includes('requirePermission("sendouts.manage")'));
  assert.ok(route.includes("canAccessBranch(session, branchId)"));
  assert.ok(route.includes("SPECIMEN_PREANALYTICAL_STATE_CHANGED"));
});

test("Org-wide patient search retains branch-scoped clinical, specimen and finance disclosure", () => {
  const page=readFileSync("src/app/search/page.tsx","utf8");
  for(const scope of ['permissions.has("patients.view")',
    'permissions.has("orders.view")','permissions.has("specimens.view")',
    'permissions.has("billing.view")',
    'orderingBranchId: { in: branchIds }','branchId: { in: branchIds }',
    'currentBranchId: { in: branchIds }'])assert.ok(page.includes(scope),scope);
  assert.ok(page.includes("organizationId: orgId"));
});

test("Clinical AST susceptibility edit is a compact modal with guarded unsaved state", () => {
  const ui=readFileSync("src/components/microbiology-case-editor.tsx","utf8");
  assert.ok(ui.includes('setEditor("susceptibility")'));
  assert.ok(ui.includes('<CrudModal open={editor === "susceptibility"}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('{editor === "susceptibility" && <form'));
  assert.ok(ui.includes('{editor === "susceptibility" && errorMessage'));
  assert.ok(ui.includes('if (!busy) setEditor(null)'));
  assert.ok(ui.includes('setRows([emptyRow(1)])'));
  assert.ok(ui.includes('setEditor(null)'));
  assert.ok(ui.includes('disabled={busy !== "" || isolates.length === 0 || antibiotics.length === 0}'));
  assert.ok(!ui.includes('      <form className="catalog-form" onSubmit={addSusceptibility}>'));
});
