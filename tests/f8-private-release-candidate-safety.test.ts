import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root=resolve(process.cwd());
const prepare=join(root,"scripts/operations/f8-private-release-candidate.mjs");
const assessor=join(root,"scripts/operations/stage132-acceptance-gate.mjs");
const run=(script:string,args:string[])=>spawnSync(process.execPath,[script,...args],{cwd:root,encoding:"utf8"});
const SHA="a".repeat(40);

test("F8: private candidate carries all 88 unexecuted sections and seven unapproved gates",()=>{
  const dir=mkdtempSync(join(tmpdir(),"familylab-f8-private-"));
  try {
    const target=join(dir,"candidate.json");
    const result=run(prepare,["--sha",SHA,"--out",target]);
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.match(result.stdout,/F8_PRIVATE_CANDIDATE_CREATED_UNVERIFIED/);
    const candidate=JSON.parse(readFileSync(target,"utf8"));
    assert.equal(candidate.releaseCandidateSha,SHA);
    assert.match(candidate.originalStage132BaselineSha,/^[a-f0-9]{40}$/);
    assert.equal(candidate.ownerConfirmedDeployment,"NOT_VERIFIED");
    assert.equal(candidate.stageStatus,"NOT_EXECUTED");
    assert.equal(candidate.candidatePreparation,"PRIVATE_UNVERIFIED_MAIN_CI_HOSTINGER_AND_HUMAN_UAT_PENDING");
    assert.equal(Object.keys(candidate.gateRoles).length,7);
    assert.equal(candidate.cases.length,88);
    assert.deepEqual(candidate.cases.map((c:{section:number})=>c.section),
      Array.from({length:88},(_,i)=>i+1));
    assert.ok(candidate.cases.every((c:{executionStatus:string})=>c.executionStatus==="NOT_EXECUTED"));
    assert.equal(statSync(target).mode & 0o777,0o600,"private template must not be world-readable");
    assert.equal(run(assessor,["--check-template","--template",target]).status,0);
    const evidence=join(dir,"fake-evidence.json");
    // Even a syntactically valid candidate cannot pass assessment until deployment is confirmed.
    const denied=run(assessor,["--assess",evidence,"--template",target]);
    assert.equal(denied.status,1);
    assert.match(denied.stdout,/Hostinger deployment has not been independently confirmed/);
    // A second preparation cannot overwrite a version already frozen for private review.
    assert.equal(run(prepare,["--sha",SHA,"--out",target]).status,1);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});

test("F8: candidate preparation rejects invalid SHA, relative and repository-local destinations",()=>{
  const dir=mkdtempSync(join(tmpdir(),"familylab-f8-denials-"));
  try {
    for(const sha of ["1234","0".repeat(40),"z".repeat(40)]) {
      const r=run(prepare,["--sha",sha,"--out",join(dir,"candidate.json")]);
      assert.equal(r.status,1,r.stdout+r.stderr);
    }
    assert.equal(run(prepare,["--sha",SHA,"--out","candidate.json"]).status,1);
    const internal=run(prepare,["--sha",SHA,"--out",join(root,"public-uat-evidence.json")]);
    assert.equal(internal.status,1);
    assert.match(internal.stderr,/PUBLIC_REPOSITORY_PATH/);
    const missing=run(assessor,["--assess",join(dir,"none.json"),"--template","relative.json"]);
    assert.equal(missing.status,1);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
