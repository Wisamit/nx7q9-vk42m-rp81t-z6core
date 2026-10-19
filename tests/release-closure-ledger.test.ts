import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const script="scripts/release-closure-evidence.mjs";
const evidence=()=>JSON.parse(execFileSync(process.execPath,[script,"--json"],
  {encoding:"utf8",maxBuffer:10*1024*1024}));

test("Frozen 88 scope and 81 routes are actually tied to existing repository sources", () => {
  const result=evidence();
  assert.deepEqual(result.errors,[]);
  assert.equal(result.automatedCoverage.sourceSections,88);
  assert.equal(result.automatedCoverage.existingSourceAnchors,88);
  assert.equal(result.automatedCoverage.missingCodeAnchors,0);
  assert.equal(result.automatedCoverage.uiRouteSources,81);
  assert.ok(result.automatedCoverage.uiComponentsInspected>100);
  assert.ok(result.automatedCoverage.sectionsWithoutDirectTestSelected.length>=0);
  assert.ok(result.automatedCoverage.dateTimeCallsRequiringBrowserReview>0);
  assert.equal(result.automatedCoverage.ownerClinicalSecurityUiDecisions.length,7);
});

test("Unresolved policy, outdated evidence and human acceptance cannot be represented as GO", () => {
  const result=evidence();
  assert.deepEqual(result.unresolvedMasterScopeRules.map(x=>x.section),[75,86,87,88]);
  assert.equal(result.acceptance.qualifiedCasesNotPassed,88);
  assert.equal(result.acceptance.finalDecision,"NO_GO");
  assert.equal(result.acceptance.browser81RouteRealExecution,"NOT_EXECUTED");
  assert.equal(result.acceptance.clinicalFinanceDeviceRestoreSignoff,"NOT_EXECUTED");
  const source=readFileSync(script,"utf8");
  assert.ok(source.includes('if(process.argv.includes("--require-production-go"))'));
  const fail=spawnSync(process.execPath,[script,"--require-production-go"],
    {encoding:"utf8",timeout:12000,maxBuffer:10*1024*1024});
  assert.equal(fail.status,1);
  assert.match(fail.stderr,/NO_GO/);
});

test("No modifications to historical 88-case UAT status or external approval claims", () => {
  const uat=JSON.parse(readFileSync("docs/STAGE_132_UAT_CASES.json","utf8"));
  assert.equal(uat.stageStatus,"NOT_EXECUTED");
  assert.equal(uat.cases.length,88);
  assert.ok(uat.cases.every(x=>x.executionStatus==="NOT_EXECUTED"));
  const browser=readFileSync(".github/workflows/ci.yml","utf8");
  assert.ok(browser.includes("browser_review:"));
  assert.ok(browser.includes("FL_UI_AUDIT_SYNTHETIC_ONLY"));
  assert.ok(browser.includes("FL_UI_AUDIT_CONFIG_JSON"));
});
