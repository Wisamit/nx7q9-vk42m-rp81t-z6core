import test from "node:test";
import assert from "node:assert/strict";
import {evaluateAutoverification}
  from "../src/lib/autoverification.ts";
import {validationHoldMatches}
  from "../src/lib/validation-holds.ts";
import {readFileSync} from "node:fs";

const policy={
  id:"synthetic-policy",enabled:true,allowManual:true,
  allowAnalyzer:true,allowImport:false,
  requireNoCritical:true,requireDeltaWithinLimit:true,
  requireNoPendingReflex:true,requireNoBlockingHolds:true,
  requireAllFlagsNormal:false,
};
const base={
  policy,source:"ANALYZER" as const,complete:true,
  values:[{flag:"NORMAL" as const,isAbnormal:false,isCritical:false,
    deltaEvaluation:"WITHIN_LIMIT" as const}],
  pendingReflexCount:0,blockingHoldCount:0,
  qcGate:{status:"PASS" as const,reasons:[]},
};

test("F4 clinical: an unclassified analyzer result must route to review despite optional all-normal policy",()=>{
  const unknown=evaluateAutoverification({
    ...base,values:[{...base.values[0],flag:"UNKNOWN" as const}],
  });
  assert.equal(unknown.eligible,false);
  assert.ok(unknown.reasons.includes("ANALYZER_UNCLASSIFIED_RESULT_REQUIRES_REVIEW"));
  const mixed=evaluateAutoverification({
    ...base,values:[base.values[0],{...base.values[0],flag:"UNKNOWN" as const}],
  });
  assert.equal(mixed.eligible,false);
  assert.ok(mixed.reasons.includes("ANALYZER_UNCLASSIFIED_RESULT_REQUIRES_REVIEW"));
  assert.equal(evaluateAutoverification(base).eligible,true);
});

test("F4 clinical: unknown flag does not silently authorize auto release when other policies are absent",()=>{
  const result=evaluateAutoverification({
    ...base,policy:null,
    values:[{...base.values[0],flag:"UNKNOWN" as const}],
  });
  assert.equal(result.eligible,false);
  assert.ok(result.reasons.includes("NO_ACTIVE_POLICY"));
});

test("F4 clinical: invalid hold condition and missing source require manual resolution rather than fallthrough",()=>{
  const input={source:"ANALYZER" as const,
    values:[{flag:"NORMAL" as const,isAbnormal:false,isCritical:false,
      deltaEvaluation:"WITHIN_LIMIT" as const}]};
  assert.equal(validationHoldMatches({
    condition:"ANY_ABNORMAL",resultSource:null,
  },input),false);
  assert.equal(validationHoldMatches({
    condition:"RESULT_SOURCE",resultSource:"MANUAL",
  },input),false);
  assert.equal(validationHoldMatches({
    condition:"RESULT_SOURCE",resultSource:null,
  },input),true);
  assert.equal(validationHoldMatches({
    condition:"UNAPPROVED" as "ALWAYS",resultSource:null,
  },input),true);
  assert.equal(validationHoldMatches({
    condition:"ANY_CRITICAL",resultSource:null,
  },input),false);
});

test("F4 clinical: analyzer and manual pathways still call guarded policy engines",()=>{
  const analyzer=readFileSync(
    "src/app/api/analyzers/imports/commit/route.ts","utf8");
  const manual=readFileSync("src/app/api/results/route.ts","utf8");
  assert.match(analyzer,/evaluateAutoverification\(/);
  assert.match(analyzer,/validationHoldMatches\(/);
  assert.match(manual,/evaluateAutoverification\(/);
});
