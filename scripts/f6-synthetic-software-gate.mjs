/**
 * F6 software evidence preflight; no browser/device/DR/go-live authorization.
 * Counts and ownership are anchored to the frozen F0 88-section triage,
 * and test execution is still verified separately by the exact-SHA CI jobs.
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const from=(relative)=>JSON.parse(fs.readFileSync(path.join(root,relative),"utf8"));
const exists=(p)=>fs.existsSync(path.join(root,p));
const missedSections=[9,18,29,72,81];
const directEvidence="tests/f6-five-unmapped-scope-regressions.test.ts";
const crossModule=[
  "tests/stage-130-cross-module-mariadb.integration.test.ts",
  "tests/stage-131-payment-replay-mariadb.integration.test.ts",
  "tests/stage-125-delta-autoverification-mariadb.integration.test.ts",
  "tests/release-closure-result-order-lock-mariadb.integration.test.ts",
  "tests/release-closure-specimen-order-guard-mariadb.integration.test.ts",
  "tests/release-closure-transfer-order-dispatch-mariadb.integration.test.ts",
  "tests/release-closure-sendout-serialization-mariadb.integration.test.ts",
  "tests/stage-139-report-template-governance-mariadb.integration.test.ts",
  "tests/stage-129-hostinger-backup.test.mjs",
  "tests/f6-five-unmapped-scope-regressions.test.ts",
];

export function auditF6SoftwareEvidence(f0,uat,options={}){
  const problems=[];
  const isFile=options.exists??exists;
  const testsFile=options.testSource??fs.readFileSync(path.join(root,directEvidence),"utf8");
  const workflow=options.workflow??fs.readFileSync(path.join(root,".github/workflows/ci.yml"),"utf8");
  const evidenceRows=[];
  if(f0.schemaVersion!==1||f0.originalScope?.sectionCount!==88||
     !/^[a-f0-9]{64}$/.test(f0.originalScope?.sha256??"")||
     f0.originalScope?.name!=="02_MASTER_SCOPE.md")
    problems.push("F6_FROZEN_MASTER_SCOPE_INVALID");
  if(!Array.isArray(f0.sectionEntries)||f0.sectionEntries.length!==88||
     !Array.isArray(uat.cases)||uat.cases.length!==88)
    problems.push("F6_88_SECTION_COUNTS_MISMATCH");
  for(let i=0;i<88;i++){
    const section=i+1, row=f0.sectionEntries?.[i],caseEntry=uat.cases?.[i];
    if(row?.section!==section || caseEntry?.section!==section ||
       row?.title!==caseEntry?.title ||
       row?.primaryAcceptanceGate!==caseEntry?.primaryGate)
      problems.push("F6_SECTION_OR_ACCEPTANCE_GATE_MISMATCH_"+section);
    const selected=missedSections.includes(section)?directEvidence:row?.stage131SelectedTest;
    if(typeof row?.sourceAnchor!=="string"||!isFile(row.sourceAnchor))
      problems.push("F6_MISSING_SOURCE_ANCHOR_"+section);
    if(typeof selected!=="string"||!selected.startsWith("tests/")||!isFile(selected))
      problems.push("F6_MISSING_DIRECT_TEST_ANCHOR_"+section);
    if(missedSections.includes(section)&&!testsFile.includes('test("§'+section+" "))
      problems.push("F6_NEW_DIRECT_TEST_NOT_DEFINED_"+section);
    evidenceRows.push({
      section,title:row?.title||null,sourceAnchor:row?.sourceAnchor||null,
      selectedTest:selected||null,
      evidenceKind:missedSections.includes(section)
        ?"NEW_F6_DIRECT_REGRESSION"
        :"HISTORICAL_TEST_ANCHOR_PLUS_REQUIRED_CI",
      qualifiedAcceptance:caseEntry?.executionStatus??"UNKNOWN",
      qualifiedGate:caseEntry?.primaryGate??null,
    });
  }
  for(const file of crossModule){
    if(!isFile(file))problems.push("F6_INTEGRATION_EVIDENCE_FILE_MISSING_"+file);
    // Basic suite invocation is intentionally exact, not pattern-count theater.
    if(file!==directEvidence && !workflow.includes(file))
      problems.push("F6_REQUIRED_INTEGRATION_NOT_IN_CI_"+file);
  }
  if(!workflow.includes("npm run test:safety"))
    problems.push("F6_FULL_SAFETY_SUITE_NOT_IN_CI");
  if(!workflow.includes("npx next build"))
    problems.push("F6_PRODUCTION_BUILD_NOT_IN_CI");
  if(!workflow.includes("npx tsc --noEmit"))
    problems.push("F6_TYPESCRIPT_NOT_IN_CI");
  if(!workflow.includes("npm run lint"))
    problems.push("F6_LINT_NOT_IN_CI");
  const externallyAccepted=uat.cases.filter(x=>x.executionStatus==="PASS").length;
  const unresolved=uat.cases.length-externallyAccepted;
  return {
    schemaVersion:1,
    workflow:"F6_SOFTWARE_ONLY_NO_BROWSER_OR_OPERATIONS",
    sourceSha:options.sha??process.env.GITHUB_SHA??null,
    frozenScope:{sectionsExpected:88,sectionsTraced:evidenceRows.filter(x=>x.selectedTest&&x.sourceAnchor).length,
      sourceSha256:f0.originalScope?.sha256??null},
    fiveHistoricallyUnmapped:missedSections.map(section=>({section,test:directEvidence})),
    crossDomainSuiteAnchors:crossModule,
    sectionEvidence:evidenceRows,
    externalAcceptance:{
      passed:externallyAccepted,unexecuted:unresolved,
      realUatStatus:uat.stageStatus,
      ownerBrowserReview:"F7_DEFERRED_BY_OWNER",
      clinicalFinanceDeviceDRRelease:"F8_NO_GO_UNTIL_QUALIFIED_SIGNATURES",
      hostingerRelease:"NOT_VERIFIED_BY_THIS_TEST",
    },
    result:problems.length===0?"F6_SOURCE_EVIDENCE_GATE_PASS":"F6_SOURCE_EVIDENCE_GATE_FAIL",
    problems,
    qualification:"Selected code/test anchors plus successful synthetic CI are not 88 individual runtime journeys, actual browser acceptance or operational authorization.",
  };
}
function renderMd(e){
  return [
    "# F6 — Integrated synthetic software evidence (NOT GO-LIVE)", "",
    "Source SHA: `"+(e.sourceSha??"local/unpinned")+"`",
    "Frozen original Master Scope SHA-256: `"+e.frozenScope.sourceSha256+"`", "",
    "| Gate | Outcome |","| --- | --- |",
    "| Frozen scope | "+e.frozenScope.sectionsTraced+"/88 source + selected test anchors |",
    "| Previously unmapped sections | "+e.fiveHistoricallyUnmapped.map(x=>"§"+x.section).join(", ")+" — direct synthetic regression added |",
    "| Cross-domain suite anchors | "+e.crossDomainSuiteAnchors.length+"; execution separately evidenced by CI |",
    "| Qualified original-source/clinical/finance/device DR | **NO_GO** |",
    "| F7 interactive browser review | **DEFERRED** |",
    "| F8 operational acceptance | "+e.externalAcceptance.passed+"/88 PASS (NOT GO) |",
    "| Software gate | "+e.result+" |", "",
    ...e.problems.map(p=>"- ERROR: "+p),"",
    "Every section retains its source anchor, test identity and qualified external acceptance gate. This audit does NOT mark 88 individually executed journeys or any real signoff.",
  ].join("\n");
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const evidence=auditF6SoftwareEvidence(from("docs/F0_SCOPE_88_TRIAGE.json"),
      from("docs/STAGE_132_UAT_CASES.json"));
    if(process.argv.includes("--json"))console.log(JSON.stringify(evidence,null,2));
    else if(process.argv.includes("--markdown"))console.log(renderMd(evidence));
    else console.log(JSON.stringify({result:evidence.result,sections:evidence.frozenScope.sectionsTraced,
      qualifiedGo:"NO_GO",errors:evidence.problems}));
    if(evidence.problems.length||process.argv.includes("--require-operational-go"))
      process.exitCode=1;
  } catch(error){console.error("F6_GATE_EXECUTION_FAILED");process.exitCode=1;}
}
