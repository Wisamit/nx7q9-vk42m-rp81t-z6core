import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
// @ts-expect-error An explicit Node ESM build-tool entrypoint, not a runtime TS module.
import {auditF6SoftwareEvidence} from "../scripts/f6-synthetic-software-gate.mjs";

const f0=JSON.parse(readFileSync("docs/F0_SCOPE_88_TRIAGE.json","utf8"));
const uat=JSON.parse(readFileSync("docs/STAGE_132_UAT_CASES.json","utf8"));
const clone=<T,>(v:T):T=>structuredClone(v);

test("F6: original 88-section scope maps to direct regression test anchors, F7/F8 remain blocked",()=>{
  const audit=auditF6SoftwareEvidence(f0,uat,{sha:"synthetic-test"});
  assert.equal(audit.result,"F6_SOURCE_EVIDENCE_GATE_PASS",audit.problems.join(", "));
  assert.equal(audit.frozenScope.sectionsExpected,88);
  assert.equal(audit.frozenScope.sectionsTraced,88);
  assert.deepEqual(audit.fiveHistoricallyUnmapped.map((x:{section:number})=>x.section),
    [9,18,29,72,81]);
  assert.deepEqual(audit.sectionEvidence.map((x:{section:number})=>x.section),
    Array.from({length:88},(_,i)=>i+1));
  assert.equal(audit.externalAcceptance.realUatStatus,"NOT_EXECUTED");
  assert.equal(audit.externalAcceptance.clinicalFinanceDeviceDRRelease,
    "F8_NO_GO_UNTIL_QUALIFIED_SIGNATURES");
  assert.equal(audit.externalAcceptance.ownerBrowserReview,"F7_DEFERRED_BY_OWNER");
  assert.equal(audit.externalAcceptance.hostingerRelease,"NOT_VERIFIED_BY_THIS_TEST");
  assert.equal(audit.sourceSha,"synthetic-test");
});

test("F6: acceptance case identity, qualified medical/finance gate and frozen master count are immutable to software evidence",()=>{
  const swapped=clone(uat);
  swapped.cases[4].primaryGate="OWNER_FINAL";
  assert.ok(auditF6SoftwareEvidence(f0,swapped).problems
    .some((x:string)=>x.includes("F6_SECTION_OR_ACCEPTANCE_GATE_MISMATCH_5")));
  const reordered=clone(f0);
  [reordered.sectionEntries[19],reordered.sectionEntries[20]]=
    [reordered.sectionEntries[20],reordered.sectionEntries[19]];
  assert.ok(auditF6SoftwareEvidence(reordered,uat).problems
    .some((x:string)=>x.includes("F6_SECTION_OR_ACCEPTANCE_GATE_MISMATCH_20")));
  const removed=clone(f0);
  removed.sectionEntries.pop();
  assert.ok(auditF6SoftwareEvidence(removed,uat).problems.includes("F6_88_SECTION_COUNTS_MISMATCH"));
  const forged=clone(f0);
  forged.originalScope.sectionCount=87;
  assert.ok(auditF6SoftwareEvidence(forged,uat).problems.includes("F6_FROZEN_MASTER_SCOPE_INVALID"));
});

test("F6: deleting a real source, rewriting one direct test, or skipping a major integration must fail closed",()=>{
  const cannotFind=(path:string)=>path!=="src/lib/formula-engine.ts" &&
    path!=="tests/stage-130-cross-module-mariadb.integration.test.ts";
  const missing=auditF6SoftwareEvidence(f0,uat,{exists:cannotFind});
  assert.ok(missing.problems.includes("F6_MISSING_SOURCE_ANCHOR_9"));
  assert.ok(missing.problems.some((x:string)=>x.includes("F6_INTEGRATION_EVIDENCE_FILE_MISSING_")));
  const noDirect=auditF6SoftwareEvidence(f0,uat,{testSource:"not valid"});
  assert.ok(noDirect.problems.includes("F6_NEW_DIRECT_TEST_NOT_DEFINED_9"));
  const noCI=auditF6SoftwareEvidence(f0,uat,{workflow:"npm run test:safety"});
  assert.ok(noCI.problems.some((x:string)=>x.startsWith("F6_REQUIRED_INTEGRATION_NOT_IN_CI")));
  assert.ok(noCI.problems.includes("F6_PRODUCTION_BUILD_NOT_IN_CI"));
});
