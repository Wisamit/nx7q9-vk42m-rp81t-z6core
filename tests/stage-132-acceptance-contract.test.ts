import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const root=resolve(process.cwd());
const t=JSON.parse(readFileSync(join(root,"docs/STAGE_132_UAT_CASES.json"),"utf8")) as {
  releaseCandidateSha:string;
  stageStatus:string;
  gateRoles:Record<string,string>;
  cases:Array<{section:number;executionStatus:string;primaryGate:string;minimumEvidence:string}>;
};
const cli=join(root,"scripts/operations/stage132-acceptance-gate.mjs");
const run=(args:string[])=>spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:"utf8"});

test("88 real-world Master Scope entries remain explicitly NOT_EXECUTED",()=>{
  assert.equal(t.cases.length,88);
  assert.deepEqual(t.cases.map(c=>c.section),Array.from({length:88},(_,i)=>i+1));
  assert.equal(t.stageStatus,"NOT_EXECUTED");
  assert.equal(Object.keys(t.gateRoles).length,7);
  for(const c of t.cases){assert.equal(c.executionStatus,"NOT_EXECUTED");assert.ok(c.minimumEvidence);assert.ok(t.gateRoles[c.primaryGate]);}
});
test("CI preflight only certifies template completeness, not clinical success",()=>{
  const r=run(["--check-template"]);
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,/TEMPLATE_VALID: 88\/88 NOT_EXECUTED/);
});
test("stale or incomplete external evidence fails closed",()=>{
  const dir=mkdtempSync(join(tmpdir(),"familylab-uat-"));
  try {
    const path=join(dir,"private.json");
    assert.equal(run(["--assess",path]).status,1);
    writeFileSync(path,JSON.stringify({releaseCandidateSha:"0".repeat(40),environment:"HOSTINGER_PRODUCTION",openCriticalDefects:1,cases:[{section:1,status:"PASS",evidence:[],executedBy:"same-user",reviewedBy:"same-user"}],gateSignoffs:[]}));
    const r=run(["--assess",path]);assert.equal(r.status,1);assert.match(r.stdout,/NO_GO_PRIVATE_CONSOLIDATED_CAMPAIGN_REQUIRED/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test("historical 88-only synthetic metadata cannot count as final combined F7+F8 UAT",()=>{
  const dir=mkdtempSync(join(tmpdir(),"familylab-uat-"));
  try {
    const path=join(dir,"synthetic.json");
    const m={releaseCandidateSha:t.releaseCandidateSha,environment:"HOSTINGER_PRODUCTION",openCriticalDefects:0,
      cases:t.cases.map(c=>({section:c.section,status:"PASS",evidence:[{ref:"synthetic-fixture-"+c.section,sha256:"a".repeat(64)}],executedBy:"test-operator-"+c.section,reviewedBy:"test-reviewer-"+c.section,executedAt:"2026-10-15T10:00:00Z",reviewedAt:"2026-10-15T11:00:00Z"})),
      gateSignoffs:Object.entries(t.gateRoles).map(([gateId,reviewerRole])=>({gateId,reviewerRole,decision:"APPROVED",reviewerId:"synthetic-reviewer-"+gateId,decidedAt:"2026-10-15T12:00:00Z",evidenceRef:"synthetic-attestation-"+gateId}))};
    writeFileSync(path,JSON.stringify(m));
    const denied=run(["--assess",path]);
    assert.equal(denied.status,1,denied.stdout+denied.stderr);
    assert.match(denied.stdout,/NO_GO_PRIVATE_CONSOLIDATED_CAMPAIGN_REQUIRED/);
    m.cases[10].reviewedBy=m.cases[10].executedBy;writeFileSync(path,JSON.stringify(m));assert.equal(run(["--assess",path]).status,1);
    m.cases[10].reviewedBy="test-reviewer-11";m.cases[10].evidence=[];writeFileSync(path,JSON.stringify(m));assert.equal(run(["--assess",path]).status,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
