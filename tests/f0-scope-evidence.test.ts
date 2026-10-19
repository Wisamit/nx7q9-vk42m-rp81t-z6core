import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { f0ScopeGate } from "../scripts/f0-scope-gate.mjs";

const copy=()=>JSON.parse(readFileSync("docs/F0_SCOPE_88_TRIAGE.json","utf8"));
const base=f0ScopeGate();
test("F0 88 requirements, 81 routes and 10 assigned risks are structurally verified",()=>{
  assert.deepEqual(base.errors,[]);
  assert.equal(base.sections,88);
  assert.equal(base.sourceAnchors,88);
  assert.equal(base.selectedTests,83);
  assert.deepEqual(base.missingSelectedTests,[9,18,29,72,81]);
  assert.equal(base.pages,81);
  assert.equal(base.risks,10);
  assert.equal(base.unassignedRisks,0);
  assert.equal(base.uat.NOT_EXECUTED,88);
  assert.equal(base.browser,"NOT_EXECUTED");
  assert.equal(base.clinicalGo,"NO_GO");
});
test("Historical categories cannot be silently upgraded",()=>{
  assert.deepEqual(base.historicCategories,{
    APPROVAL_DEPENDENT:48,
    SOFTWARE_READY:5,
    VENDOR_OR_REAL_WORLD_DEPENDENT:31,
    BUSINESS_RULE_OR_DATA_UNRESOLVED:4,
  });
});
test("An omitted section or a retitled master requirement fails closed",()=>{
  const a=copy();a.sectionEntries.splice(20,1);
  assert.ok(f0ScopeGate({ledger:a}).errors.some(e=>/88|reordered/.test(e)));
  const b=copy();b.sectionEntries[0].title="Guessed title";
  assert.ok(f0ScopeGate({ledger:b}).errors.some(e=>/title/.test(e)));
});
test("No source-only row may be signed, clinically approved or fabricated",()=>{
  const a=copy();
  a.sectionEntries[11].closureState="SIGNED";
  a.sectionEntries[11].currentSourceTestCoverage="FULLY_VERIFIED";
  const errors=f0ScopeGate({ledger:a}).errors;
  assert.ok(errors.some(e=>/False implementation/.test(e)));
});
test("Missing phase, accountable owner or required P1 risk fails closed",()=>{
  const a=copy();
  a.triagedRisks[0].owner="";
  a.triagedRisks[1].phase="";
  a.triagedRisks=a.triagedRisks.filter((x: { id: string })=>x.id!=="LAB-075");
  const errors=f0ScopeGate({ledger:a}).errors;
  assert.ok(errors.some(e=>/Untriaged risk/.test(e)));
  assert.ok(errors.some(e=>/Required P1/.test(e)));
});
test("Clinical and browser gate cannot be bypassed during F0",()=>{
  const a=copy();
  a.uat.clinicalGo="GO";
  a.routeScope.ownerBrowserQA="DONE";
  const errors=f0ScopeGate({ledger:a}).errors;
  assert.ok(errors.some(e=>/medical or qualified approval/.test(e)));
  assert.ok(errors.some(e=>/browser gate/.test(e)));
});
test("Qualified personnel and actual evidence must remain linked to each section",()=>{
  const a=copy();
  a.sectionEntries[0].requiredQualifiedRole="";
  a.sectionEntries[0].minimumRealWorldEvidence="No evidence needed";
  assert.ok(f0ScopeGate({ledger:a}).errors.some(e=>/Human qualified evidence/.test(e)));
});
