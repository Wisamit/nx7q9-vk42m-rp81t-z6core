import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    const f7=candidate.f7VisualAcceptance;
    assert.equal(f7.state,"NOT_EXECUTED");
    assert.equal(f7.routeCount,81);
    assert.equal(f7.scenarioCount,6);
    assert.equal(f7.caseCount,486);
    assert.equal(f7.cases.length,486);
    assert.equal(new Set(f7.cases.map((c:{route:string;scenario:string})=>
      JSON.stringify([c.route,c.scenario]))).size,486);
    assert.ok(f7.cases.every((c:{executionStatus:string})=>
      c.executionStatus==="NOT_EXECUTED"));
    assert.equal(candidate.gateSignoffs,undefined,"no approvals may be prefilled");
    assert.equal(statSync(target).mode & 0o777,0o600,"private template must not be world-readable");
    assert.equal(run(assessor,["--check-template","--template",target]).status,0);
    const evidence=join(dir,"fake-evidence.json");
    // Even a syntactically valid candidate cannot pass assessment until deployment is confirmed.
    const denied=run(assessor,["--assess",evidence,"--template",target]);
    assert.equal(denied.status,1);
    assert.match(denied.stdout,/matching main CI and Hostinger deployment attestation metadata required/);
    candidate.ownerConfirmedDeployment="YES";
    const spoofed=join(dir,"spoofed.json");
    writeFileSync(spoofed,JSON.stringify(candidate));
    assert.equal(run(assessor,["--assess",evidence,"--template",spoofed]).status,1,
      "An arbitrary confirmation string must never count as deployment evidence");
    candidate.ownerConfirmedDeployment="HOSTINGER_EXACT_SHA_ATTESTED";
    candidate.deploymentVerification={deployedSha:"b".repeat(40),mainCiSha:SHA,
      mainCiRunId:1,reviewedBy:"owner-reviewer",evidenceRef:"private-attestation",
      reviewedAt:"2026-10-22T18:00:00Z"};
    writeFileSync(spoofed,JSON.stringify(candidate));
    assert.equal(run(assessor,["--assess",evidence,"--template",spoofed]).status,1,
      "Even valid-looking attestations must bind the EXACT main SHA");
    candidate.deploymentVerification.deployedSha=SHA;
    writeFileSync(spoofed,JSON.stringify(candidate));
    assert.match(run(assessor,["--assess",evidence,"--template",spoofed]).stdout,
      /private evidence missing or invalid JSON/,
      "With matching attestation metadata the assessor must still require real private 88-case evidence");
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

test("F8 + F7 final: 88-case and seven-signoff metadata cannot bypass the 486 private human visual reviews",()=>{
  const dir=mkdtempSync(join(tmpdir(),"familylab-f7f8-combined-"));
  try {
    const template=join(dir,"candidate.json");
    assert.equal(run(prepare,["--sha",SHA,"--out",template]).status,0);
    const candidate=JSON.parse(readFileSync(template,"utf8"));
    const malformed=join(dir,"malformed-template.json");
    const incomplete={...candidate,f7VisualAcceptance:{
      ...candidate.f7VisualAcceptance,
      cases:candidate.f7VisualAcceptance.cases.slice(1),
    }};
    writeFileSync(malformed,JSON.stringify(incomplete));
    assert.equal(run(assessor,["--check-template","--template",malformed]).status,1,
      "missing even one of 486 route/context cases invalidates the private campaign");

    // SYNTHETIC negative-only metadata. No real operator, photograph,
    // clinical outcome or approval is created by this automated test.
    candidate.ownerConfirmedDeployment="HOSTINGER_EXACT_SHA_ATTESTED";
    candidate.deploymentVerification={deployedSha:SHA,mainCiSha:SHA,
      mainCiRunId:123,reviewedBy:"synthetic-deployment-reviewer",
      evidenceRef:"synthetic-private-ref",reviewedAt:"2026-10-24T10:00:00Z"};
    writeFileSync(template,JSON.stringify(candidate));
    const m={
      releaseCandidateSha:SHA,environment:"HOSTINGER_PRODUCTION",
      openCriticalDefects:0,
      cases:candidate.cases.map((c:{section:number})=>({
        section:c.section,status:"PASS",
        evidence:[{ref:"synthetic-case-ref",sha256:"b".repeat(64)}],
        executedBy:"synthetic-executor",reviewedBy:"synthetic-reviewer",
        executedAt:"2026-10-24T11:00:00Z",reviewedAt:"2026-10-24T11:05:00Z",
      })),
      gateSignoffs:Object.entries(candidate.gateRoles).map(([gateId,reviewerRole],i)=>({
        gateId,reviewerRole,decision:"APPROVED",
        reviewerId:"synthetic-gate-"+i,evidenceRef:"synthetic-review-ref",
        decidedAt:gateId==="OWNER_FINAL"?"2026-10-24T13:00:00Z":"2026-10-24T12:00:00Z",
      })),
    };
    const evidence=join(dir,"evidence.json");
    writeFileSync(evidence,JSON.stringify(m));
    const missing=run(assessor,["--assess",evidence,"--template",template]);
    assert.equal(missing.status,1);
    assert.match(missing.stdout,/F7 private human review requires all 486 cases/);
    m.gateSignoffs[1].reviewerId=m.gateSignoffs[0].reviewerId;
    writeFileSync(evidence,JSON.stringify(m));
    const duplicate=run(assessor,["--assess",evidence,"--template",template]);
    assert.equal(duplicate.status,1);
    assert.match(duplicate.stdout,/Gate signers must be seven independent people/);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
