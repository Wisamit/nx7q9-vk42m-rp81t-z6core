import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {deltaHistoricalValueWhere} from "../src/lib/delta-check.ts";

const base={
  organizationId:"ORG_A",patientId:"PATIENT_A",testId:"TEST_A",
  componentId:null,componentCode:"TSH",
  methodId:"METHOD_A",unitId:"UNIT_A",unitSnapshot:"mIU/L",
  lookbackStart:new Date("2026-09-01T00:00:00.000Z"),
  at:new Date("2026-10-14T00:00:00.000Z"),
};
test("Stage 124: null-component legacy observation selects only its exact source code and measurement context",()=>{
  const where=deltaHistoricalValueWhere(base);
  assert.equal(where.componentId,null);
  assert.equal(where.componentCodeSnapshot,"TSH");
  assert.equal(where.unitId,"UNIT_A");
  assert.equal(where.unitSnapshot,"mIU/L");
  assert.equal(where.result?.methodId,"METHOD_A");
  assert.equal(where.result?.organizationId,"ORG_A");
  assert.equal(where.result?.status,"RELEASED");
  assert.equal(where.result?.orderItem?.testId,"TEST_A");
  assert.equal(where.result?.orderItem?.order?.patientId,"PATIENT_A");
  assert.equal(where.resultTypeSnapshot,"NUMERIC");
  assert.deepEqual(where.valueNumeric,{not:null});
  assert.deepEqual(where.result?.releasedAt,{gte:base.lookbackStart,lt:base.at});
});
test("Stage 124: immutable component ID is the identity even if its display code changed",()=>{
  const where=deltaHistoricalValueWhere({...base,componentId:"COMP_ID",componentCode:"RENAMED"});
  assert.equal(where.componentId,"COMP_ID");
  assert.equal(where.componentCodeSnapshot,undefined);
});
test("Stage 124: absence of analytical method or unit matches ONLY equally absent historical context",()=>{
  const where=deltaHistoricalValueWhere({...base,methodId:null,unitId:null,unitSnapshot:null});
  assert.equal(where.result?.methodId,null);
  assert.equal(where.unitId,null);
  assert.equal(where.unitSnapshot,null);
});
test("Stage 124: both manual result entry and analyzer imports pass actual component code and snapshot unit",()=>{
  const delta=readFileSync("src/lib/delta-check.ts","utf8");
  const manual=readFileSync("src/app/api/results/route.ts","utf8");
  const analyzer=readFileSync("src/app/api/analyzers/imports/commit/route.ts","utf8");
  assert.match(delta,/deltaHistoricalValueWhere/);
  assert.match(delta,/componentCodeSnapshot: input\.componentCode\.trim\(\)/);
  assert.match(delta,/methodId: input\.methodId \?\? null/);
  assert.doesNotMatch(delta,/componentCodeSnapshot: \{ not: "" \}/);
  for(const source of [manual,analyzer]){
    assert.equal((source.match(/await evaluateDelta\(prisma, \{/g)||[]).length,2);
    assert.match(source,/componentCode: (?:component|definition)\.code/);
    assert.match(source,/componentCode: target\.code/);
    assert.match(source,/unitId: target\.unitId/);
    assert.match(source,/unitSnapshot: target\.unitSnapshot/);
  }
  assert.match(manual,/componentId: component\.componentId,\s+componentCode: component\.code,\s+unitId: component\.unitId,\s+unitSnapshot: component\.unitSnapshot/);
  assert.match(analyzer,/componentId: definition\.componentId,\s+componentCode: definition\.code,\s+unitId: definition\.unitId,\s+unitSnapshot: definition\.unitSnapshot/);
});
