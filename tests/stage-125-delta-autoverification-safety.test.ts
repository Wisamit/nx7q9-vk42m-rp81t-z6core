import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {evaluateAutoverification} from "../src/lib/autoverification.ts";
import {automatedTechnicalReviewOutcome,snapshotValidationPolicy} from "../src/lib/result-validation.ts";

const policy={
  id:"POLICY",enabled:true,allowManual:true,allowAnalyzer:true,allowImport:false,
  requireNoCritical:true,requireDeltaWithinLimit:true,
  requireNoPendingReflex:true,requireNoBlockingHolds:true,
  requireAllFlagsNormal:false,
};
const value=(deltaEvaluation:"NOT_CONFIGURED"|"NO_PREVIOUS_RESULT"|"WITHIN_LIMIT"|"EXCEEDED")=>({
  flag:"NORMAL" as const,isAbnormal:false,isCritical:false,deltaEvaluation,
});
const base={
  policy,source:"ANALYZER" as const,complete:true,
  values:[value("WITHIN_LIMIT")],pendingReflexCount:0,blockingHoldCount:0,
  qcGate:{status:"PASS" as const,reasons:[]},
};
test("Stage 125: no comparable Delta baseline cannot pass required within-limit auto review",()=>{
  for(const source of ["MANUAL","ANALYZER"] as const){
    const input={...base,source,values:[value("NO_PREVIOUS_RESULT")]};
    const review=evaluateAutoverification(input);
    assert.equal(review.eligible,false,source);
    assert.equal(review.policyId,policy.id);
    assert.ok(review.reasons.includes("DELTA_COMPARABLE_BASELINE_REQUIRED"));
    assert.ok(!review.reasons.includes("DELTA_LIMIT_EXCEEDED"));
    const technical=automatedTechnicalReviewOutcome(snapshotValidationPolicy(null),{
      eligible:review.eligible,complete:true,
    });
    assert.notEqual(technical.validationStage,"MEDICAL_VALIDATION",
      "Uncomparable Delta must not be automatically advanced");
  }
});
test("Stage 125: mixed analytes fail if any Delta has no comparable historical reading",()=>{
  const decision=evaluateAutoverification({
    ...base,values:[value("WITHIN_LIMIT"),value("NO_PREVIOUS_RESULT"),value("NOT_CONFIGURED")],
  });
  assert.equal(decision.eligible,false);
  assert.deepEqual(decision.reasons,["DELTA_COMPARABLE_BASELINE_REQUIRED"]);
});
test("Stage 125: healthy configured comparison and no configured Delta still use existing gates",()=>{
  assert.equal(evaluateAutoverification(base).eligible,true);
  assert.equal(evaluateAutoverification({...base,values:[value("NOT_CONFIGURED")]}).eligible,true);
  assert.equal(evaluateAutoverification({...base,values:[]}).eligible,true);
  const exceeded=evaluateAutoverification({...base,values:[value("EXCEEDED")]});
  assert.equal(exceeded.eligible,false);
  assert.ok(exceeded.reasons.includes("DELTA_LIMIT_EXCEEDED"));
  const both=evaluateAutoverification({
    ...base,values:[value("EXCEEDED"),value("NO_PREVIOUS_RESULT")],
  });
  assert.equal(both.eligible,false);
  assert.deepEqual(both.reasons,["DELTA_LIMIT_EXCEEDED","DELTA_COMPARABLE_BASELINE_REQUIRED"]);
  assert.equal(evaluateAutoverification({...base,qcGate:{status:"WARN",reasons:[]}}).eligible,false);
  assert.equal(evaluateAutoverification({...base,pendingReflexCount:1}).eligible,false);
  assert.equal(evaluateAutoverification({...base,blockingHoldCount:1}).eligible,false);
  assert.equal(evaluateAutoverification({...base,values:[{
    ...value("WITHIN_LIMIT"),isCritical:true,
  }]}).eligible,false);
});
test("Stage 125: explicit policy requirement gates missing history; no relaxation of other blockers",()=>{
  assert.equal(evaluateAutoverification({
    ...base,policy:{...policy,requireDeltaWithinLimit:false},
    values:[value("NO_PREVIOUS_RESULT")],
  }).eligible,true);
  assert.equal(evaluateAutoverification({
    ...base,policy:{...policy,requireDeltaWithinLimit:false},
    values:[value("EXCEEDED")],
  }).eligible,false);
  assert.equal(evaluateAutoverification({...base,policy:null,values:[value("WITHIN_LIMIT")]}).eligible,false);
});
test("Stage 125: both result entry pipelines use the same fail-closed evaluation and persist review snapshot",()=>{
  const engine=readFileSync("src/lib/autoverification.ts","utf8");
  const manual=readFileSync("src/app/api/results/route.ts","utf8");
  const analyzer=readFileSync("src/app/api/analyzers/imports/commit/route.ts","utf8");
  const policyRoute=readFileSync("src/app/api/clinical-rules/autoverification/route.ts","utf8");
  assert.match(engine,/policy\.requireDeltaWithinLimit/);
  assert.match(engine,/NO_PREVIOUS_RESULT/);
  assert.match(engine,/DELTA_COMPARABLE_BASELINE_REQUIRED/);
  assert.match(engine,/DELTA_LIMIT_EXCEEDED/);
  assert.match(policyRoute,/const requireDeltaWithinLimit = true/);
  for(const source of [manual,analyzer]){
    assert.match(source,/evaluateAutoverification\(/);
    assert.match(source,/autoverificationDecisionSnapshot: .* as Prisma\.InputJsonValue/);
    assert.match(source,/automatedTechnicalReviewOutcome\(/);
  }
});
