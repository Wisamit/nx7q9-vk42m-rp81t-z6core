import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAstInterpretation, parseAstMeasurement } from "../src/lib/microbiology-ast.ts";

function source(path: string) { return readFileSync(new URL(path, import.meta.url), "utf8"); }

test("AST interpretation is explicit and never silently defaults to UNKNOWN", () => {
  for (const interpretation of ["S","I","R","NON_SUSCEPTIBLE","UNKNOWN"]) {
    assert.equal(parseAstInterpretation(interpretation), interpretation);
  }
  for (const invalid of [null,undefined,"", "susceptible","X",0,{},[]]) {
    assert.equal(parseAstInterpretation(invalid),null);
  }
});

test("AST values preserve permitted decimal precision and reject overflow, exponent, negative, invalid inputs", () => {
  assert.equal(parseAstMeasurement("0.000001",12,6),"0.000001");
  assert.equal(parseAstMeasurement("999999999999.999999",12,6),"999999999999.999999");
  assert.equal(parseAstMeasurement("9999999.999",7,3),"9999999.999");
  assert.equal(parseAstMeasurement(12.5,7,3),"12.5");
  assert.equal(parseAstMeasurement(undefined,12,6),null);
  assert.equal(parseAstMeasurement(null,12,6),null);
  assert.equal(parseAstMeasurement("",12,6),null);
  for (const input of ["-1","1e-2","0.0000001","1.2345","10000000","Infinity",Infinity,NaN,[],{}]) {
    assert.equal(parseAstMeasurement(input,7,3),undefined,JSON.stringify(input));
  }
});

test("culture, observation, isolate and AST edits lock specimen then case and reject post-submission writes", () => {
  const helper=source("../src/lib/microbiology-case-lock.ts");
  const specimen=helper.indexOf("FROM specimens");
  const specimenLock=helper.indexOf("FOR UPDATE",specimen);
  const caseLock=helper.indexOf("FROM microbiology_cases",specimenLock);
  assert.ok(specimen>=0 && specimenLock>specimen && caseLock>specimenLock);
  assert.ok(helper.includes('cases[0].status === "FINAL"'));
  assert.ok(helper.includes("cases[0].result_id && !input.allowSubmittedResult"));
  assert.ok(helper.includes("cases[0].updated_at.getTime()"));
  assert.ok(helper.includes('specimen[0].status !== "IN_PROCESS"'));
  for(const path of [
    "../src/app/api/microbiology/cases/[id]/route.ts",
    "../src/app/api/microbiology/cases/[id]/observations/route.ts",
    "../src/app/api/microbiology/cases/[id]/isolates/route.ts",
    "../src/app/api/microbiology/isolates/[isolateId]/susceptibility/route.ts",
  ]) {
    const api=source(path);
    const gate=api.indexOf("await requireEditableMicrobiologyCase(tx");
    assert.ok(gate>=0, path);
    assert.ok(api.indexOf("expectedCaseUpdatedAt:",gate)>gate,path);
    assert.match(api, /\b(?:updated|observation|isolate|susceptibilityTest)\.code\b/,path);
  }
});

test("isolate sequence allocation happens inside serialized parent transaction", () => {
  const api=source("../src/app/api/microbiology/cases/[id]/isolates/route.ts");
  const transaction=api.indexOf("const isolate = await prisma.$transaction");
  const lock=api.indexOf("await requireEditableMicrobiologyCase(tx",transaction);
  const lookup=api.indexOf("tx.microbiologyIsolate.findFirst",lock);
  const insert=api.indexOf("tx.microbiologyIsolate.create",lookup);
  assert.ok(transaction>=0 && lock>transaction && lookup>lock && insert>lookup);
  assert.ok(!api.slice(0,transaction).includes("prisma.microbiologyIsolate.findFirst"));
});

test("culture no-growth cannot coexist with recorded isolates", () => {
  const api=source("../src/app/api/microbiology/cases/[id]/route.ts");
  assert.ok(api.includes('cultureStatus === "NO_GROWTH"'));
  assert.ok(api.includes("tx.microbiologyIsolate.count"));
  assert.ok(api.includes("no_growth_conflicts_with_isolates"));
  const submission=source("../src/app/api/microbiology/cases/[id]/submit-final/route.ts");
  assert.ok(submission.includes("no_growth_conflicts_with_isolates"));
});

test("final submission and correction withdrawal claim exact case and result revisions", () => {
  const submission=source("../src/app/api/microbiology/cases/[id]/submit-final/route.ts");
  const tx=submission.indexOf("const saved = await prisma.$transaction");
  const caseLock=submission.indexOf("requireEditableMicrobiologyCase(tx",tx);
  const claim=submission.indexOf("tx.laboratoryResult.updateMany",caseLock);
  const values=submission.indexOf("tx.laboratoryResultValue.deleteMany",claim);
  assert.ok(tx>=0 && caseLock>tx && claim>caseLock && values>claim);
  assert.ok(submission.includes("expectedCaseUpdatedAt: microbiologyCase.updatedAt"));
  assert.ok(submission.includes("expectedResultId: linkedResult?.id ?? null"));
  assert.ok(submission.includes("updatedAt: linkedResult.updatedAt"));
  assert.ok(submission.includes("microbiology_result_changed_or_under_review"));

  const withdraw=source("../src/app/api/microbiology/cases/[id]/withdraw-final/route.ts");
  const withdrawalLock=withdraw.indexOf("requireEditableMicrobiologyCase(tx");
  const withdrawalClaim=withdraw.indexOf("tx.laboratoryResult.updateMany",withdrawalLock);
  const caseUpdate=withdraw.indexOf("tx.microbiologyCase.update",withdrawalClaim);
  assert.ok(withdrawalLock>=0 && withdrawalClaim>withdrawalLock && caseUpdate>withdrawalClaim);
  assert.ok(withdraw.includes("allowCorrectionWhenSpecimenUnready: true"));
  assert.ok(withdraw.includes("updatedAt: microbiologyCase.result!.updatedAt"));
  assert.ok(withdraw.includes('validationStage: { in: ["ENTRY", "TECHNICAL_REVIEW"] }'));
});

test("case creation locks current specimen and active order lineage", () => {
  const api=source("../src/app/api/microbiology/cases/route.ts");
  const transaction=api.indexOf("const created = await prisma.$transaction");
  const specimenLock=api.indexOf("FROM specimens",transaction);
  const link=api.indexOf("tx.specimenOrderItem.count",specimenLock);
  const create=api.indexOf("tx.microbiologyCase.create",link);
  assert.ok(transaction>=0 && specimenLock>transaction && link>specimenLock && create>link);
  assert.ok(api.includes('error: "microbiology_case_performing_branch_conflict"'));
});

test("microbiology UI preserves history but blocks active work when specimen custody is unsafe", () => {
  const page=source("../src/app/microbiology/[id]/page.tsx");
  assert.ok(page.includes('microbiologyCase.specimen.status === "IN_PROCESS"'));
  assert.ok(page.includes("microbiologyCase.specimen.currentBranchId === microbiologyCase.performingBranchId"));
  assert.ok(page.includes("Boolean(microbiologyCase.result) || !specimenReadyForProcessing"));
  assert.ok(page.includes("العينة غير متاحة لمعالجة الأحياء الدقيقة"));
  const workflow=source("../src/components/microbiology-final-workflow.tsx");
  assert.ok(workflow.includes("canEnter && specimenReadyForProcessing"));
  assert.ok(workflow.includes("canVerify && specimenReadyForProcessing"));
  assert.ok(workflow.includes("canRelease && specimenReadyForProcessing"));
  assert.ok(workflow.includes('resultStatus === "ENTERED" && canEnter'));
});
