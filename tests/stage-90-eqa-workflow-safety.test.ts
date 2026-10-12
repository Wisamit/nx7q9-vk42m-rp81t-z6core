import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EqaWorkflowError,eqaAssessment,eqaCode,eqaDueAt,eqaId,eqaNextState,
  eqaIndependentReviewer,eqaAllReviewed,eqaReason,eqaText,
} from "../src/lib/eqa-workflow.ts";

test("Stage 90: strict EQA clinical evidence parsing without silent truncation",()=>{
  assert.equal(eqaCode(" round_1 "),"ROUND_1");
  assert.throws(()=>eqaCode("bad code!"),(e:unknown)=>e instanceof EqaWorkflowError&&e.code==="invalid_code");
  assert.throws(()=>eqaCode("X".repeat(81)));
  assert.throws(()=>eqaText("X".repeat(301),300,true,"observed_value"));
  assert.throws(()=>eqaText("unsafe\u0000code",200,true,"value"));
  assert.throws(()=>eqaText(" ",100,true,"note"));
  assert.equal(eqaText("",100,false,"note"),null);
  assert.equal(eqaReason("Independent expert evidence reviewed"),"Independent expert evidence reviewed");
  assert.throws(()=>eqaReason("too short"));
  assert.throws(()=>eqaDueAt("2026-10-12T11:30"));
  assert.equal(eqaDueAt("2026-10-12T11:30:00.000Z")?.toISOString(),"2026-10-12T11:30:00.000Z");
  assert.throws(()=>eqaId("not-a-uuid","component_id"));
  assert.equal(eqaAssessment("UNSATISFACTORY"),"UNSATISFACTORY");
  assert.throws(()=>eqaAssessment("PASS"));
});

test("Stage 90: full EQA lifecycle, reviewer separation and all observations reviewed",()=>{
  assert.equal(eqaNextState("OPEN","SUBMIT_ROUND"),"SUBMITTED");
  assert.equal(eqaNextState("SUBMITTED","FINALIZE_REVIEW"),"ASSESSED");
  assert.equal(eqaNextState("ASSESSED","CLOSE_ROUND"),"CLOSED");
  for(const [status,action] of [["CLOSED","SUBMIT_ROUND"],["OPEN","FINALIZE_REVIEW"],
      ["SUBMITTED","CLOSE_ROUND"],["CLOSED","ADD_OBSERVATION"]] as const)
    assert.equal(eqaNextState(status,action),null);
  assert.equal(eqaIndependentReviewer("reviewer","submitter","author"),true);
  assert.equal(eqaIndependentReviewer("submitter","submitter","author"),false);
  assert.equal(eqaIndependentReviewer("author","submitter","author"),false);
  assert.equal(eqaIndependentReviewer("reviewer",null,"author"),false);
  assert.equal(eqaAllReviewed([]),false);
  assert.equal(eqaAllReviewed([{assessment:"SATISFACTORY"},{assessment:"NOT_EVALUATED"}]),true);
  assert.equal(eqaAllReviewed([{assessment:"UNSATISFACTORY"},{assessment:null}]),false);
});

test("Stage 90: API locks clinical evidence, respects branch, role and department authorization",()=>{
  const api=readFileSync("src/app/api/quality/eqa/route.ts","utf8");
  const page=readFileSync("src/app/quality/eqa/page.tsx","utf8");
  const ui=readFileSync("src/components/eqa-workspace.tsx","utf8");
  const nav=readFileSync("src/components/system-shell.tsx","utf8");
  const schema=readFileSync("prisma/schema.prisma","utf8");
  const migration=readFileSync("prisma/migrations/20261012165000_eqa_proficiency_testing/migration.sql","utf8");
  assert.match(api,/qc\.manage/);assert.match(api,/qc\.enter/);assert.match(api,/qc\.resolve/);
  assert.match(api,/SELECT id FROM organizations WHERE id = \$\{organizationId\} AND status='ACTIVE' FOR UPDATE/);
  assert.match(api,/SELECT id FROM eqa_programs WHERE id = \$\{selectedProgramId\}[\s\S]*?FOR UPDATE/);
  assert.match(api,/SELECT id FROM eqa_rounds WHERE id = \$\{roundId\}[\s\S]*?FOR UPDATE/);
  assert.match(api,/userBranchScope\.findUnique/);
  assert.match(api,/scope\.branch\.organizationId === organizationId/);
  assert.match(api,/departmentIds\.length/);
  assert.match(api,/test:\{organizationId,status:"ACTIVE"/);
  assert.match(api,/where:\{id:analyzerId,organizationId,branchId:program\.branchId,status:"ACTIVE"\}/);
  assert.match(api,/componentCodeSnapshot:component\.code/);
  assert.match(api,/observation\.assessment !== null/);
  assert.match(api,/eqaIndependentReviewer\(actorUserId,round\.submittedByUserId,observation\.createdByUserId\)/);
  assert.match(api,/eqaAllReviewed\(round\.observations\)/);
  assert.match(api,/round\.status !== "OPEN"/);
  assert.match(api,/isolationLevel:"Serializable"/);
  for(const item of ["EQA_PROGRAM_CREATED","EQA_ROUND_CREATED","EQA_OBSERVATION_RECORDED",
      "EQA_ROUND_SUBMITTED","EQA_EXTERNAL_ASSESSMENT_RECORDED",
      "EQA_ROUND_INDEPENDENTLY_REVIEWED","EQA_ROUND_CLOSED"])assert.ok(api.includes(item));
  assert.match(page,/requirePermission\("qc\.view"\)/);
  assert.match(page,/BATCH\+1/);
  assert.match(page,/scopeIds=branchFilter/);
  assert.match(ui,/CREATE_PROGRAM/);
  assert.match(ui,/CREATE_ROUND/);
  assert.match(ui,/ADD_OBSERVATION/);
  assert.match(ui,/SUBMIT_ROUND/);
  assert.match(ui,/ASSESS_OBSERVATION/);
  assert.match(ui,/FINALIZE_REVIEW/);
  assert.match(ui,/CLOSE_ROUND/);
  assert.match(nav,/href: "\/quality\/eqa"/);
  assert.match(schema,/model EqaProgram/);
  assert.match(schema,/model EqaRound/);
  assert.match(schema,/model EqaObservation/);
  assert.match(schema, /@@unique\(\[roundId, entryCode\]\)/);
  assert.match(migration,/CREATE TABLE `eqa_programs`/);
  assert.match(migration,/CREATE TABLE `eqa_rounds`/);
  assert.match(migration,/CREATE TABLE `eqa_observations`/);
  assert.match(migration,/FOREIGN KEY/);
});
