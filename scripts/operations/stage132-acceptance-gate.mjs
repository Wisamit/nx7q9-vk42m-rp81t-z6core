#!/usr/bin/env node
// Structural metadata check ONLY; never a clinical, financial or regulatory GO decision.
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { F7_SCENARIOS } from "../f7-browser-evidence-integrity.mjs";
const idOk = x => typeof x === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_:/.-]{2,159}$/.test(x);
const timeOk = x => typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
const obj = x => x !== null && typeof x === "object" && !Array.isArray(x);
const sha256 = x => typeof x === "string" && /^[0-9a-f]{64}$/i.test(x);
const allowed = new Set(["APPROVAL_DEPENDENT","SOFTWARE_READY","VENDOR_OR_REAL_WORLD_DEPENDENT","BUSINESS_RULE_OR_DATA_UNRESOLVED"]);
const F7_PRIVATE_PREP="PRIVATE_UNVERIFIED_MAIN_CI_HOSTINGER_AND_HUMAN_UAT_PENDING";
const F7_REVIEW_CHECKS=[
  "localeDirection","theme","viewportAndOverflow","keyboardAndDialogs",
  "branchRoleIsolation","timezoneAndDates","patientPrivacy",
];
function f7RequiredCases() {
  // Bind the eventual private review to the same versioned public route
  // inventory and canonical browser contexts; never accept extra/spoofed rows.
  const manifest=readJson(resolve(process.cwd(),"docs/UI_ROUTE_MANIFEST.json"));
  if(manifest.expectedRouteCount!==81||!Array.isArray(manifest.routes)||
     manifest.routes.length!==81||new Set(manifest.routes.map(r=>r.route)).size!==81||
     F7_SCENARIOS.length!==6||new Set(F7_SCENARIOS).size!==6)
    throw Error("f7_manifest_invalid");
  const cases=new Map();
  for(const r of manifest.routes){
    if(typeof r.route!=="string"||!r.route.startsWith("/")||
       typeof r.file!=="string"||!r.file.startsWith("src/app/"))
      throw Error("f7_manifest_invalid");
    for(const scenario of F7_SCENARIOS){
      cases.set(JSON.stringify([r.route,scenario]),r.file);
    }
  }
  if(cases.size!==486)throw Error("f7_manifest_incomplete");
  return cases;
}
function f7TemplateErrors(t) {
  const errors=[],f=t.f7VisualAcceptance;
  if(!obj(f)||f.state!=="NOT_EXECUTED"||
     f.routeManifest!=="docs/UI_ROUTE_MANIFEST.json"||
     f.routeCount!==81||f.scenarioCount!==6||f.caseCount!==486||
     !Array.isArray(f.cases)||f.cases.length!==486)
    return ["F7 81x6 private review contract missing"];
  let required;
  try{required=f7RequiredCases();}catch{return ["F7 canonical route inventory unavailable"];}
  const seen=new Set();
  for(const c of f.cases){
    if(!obj(c)){errors.push("F7 malformed case");continue;}
    const k=JSON.stringify([c.route,c.scenario]);
    if(seen.has(k)||!required.has(k)||required.get(k)!==c.sourceFile||
       c.executionStatus!=="NOT_EXECUTED")errors.push("F7 case missing, forged or preapproved");
    seen.add(k);
  }
  if(seen.size!==486)errors.push("F7 canonical route/context coverage incomplete");
  return errors;
}
function f7EvidenceErrors(m,t){
  if(!obj(t.f7VisualAcceptance))return [];
  const errors=[],expected=new Set(t.f7VisualAcceptance.cases.map(c=>
    JSON.stringify([c.route,c.scenario])));
  const seen=new Set(),cases=Array.isArray(m.f7Cases)?m.f7Cases:[];
  if(cases.length!==486)errors.push("F7 private human review requires all 486 cases");
  for(const c of cases){
    if(!obj(c)){errors.push("Malformed F7 private case");continue;}
    const key=JSON.stringify([c.route,c.scenario]);
    if(!expected.has(key)||seen.has(key))
      errors.push("Unknown or duplicate F7 route/context");
    seen.add(key);
    if(c.status!=="PASS"||!obj(c.f7Checks)||
       F7_REVIEW_CHECKS.some(flag=>c.f7Checks[flag]!==true))
      errors.push("F7 case lacks independent human UX/role/privacy approval");
    if(!Array.isArray(c.evidence)||!c.evidence.length||
       c.evidence.some(e=>!obj(e)||!idOk(e.ref)||!sha256(e.sha256)))
      errors.push("F7 private screenshot and review SHA256 missing");
    if(!idOk(c.executedBy)||!idOk(c.reviewedBy)||c.executedBy===c.reviewedBy||
       !timeOk(c.executedAt)||!timeOk(c.reviewedAt)||
       Date.parse(c.reviewedAt)<Date.parse(c.executedAt))
      errors.push("F7 case lacks independent dated operator/reviewer");
  }
  if(seen.size!==486)errors.push("F7 486-route/context review coverage incomplete");
  return errors;
}
function templateErrors(t) {
  const errors=[];
  if (!obj(t) || t.stage!==132 || !/^[0-9a-f]{40}$/i.test(t.releaseCandidateSha ?? "") || t.stageStatus!=="NOT_EXECUTED") errors.push("Stage 132 template header or execution state is wrong");
  if (!Array.isArray(t?.cases) || t.cases.length!==88) errors.push("Missing 88 Master Scope sections");
  if (!obj(t?.gateRoles) || Object.keys(t.gateRoles).length!==7 || !t.gateRoles.OWNER_FINAL) errors.push("Seven qualified gate roles required");
  const seen=new Set();
  for (const c of t?.cases??[]) {
    if (!Number.isInteger(c.section) || c.section<1 || c.section>88 || seen.has(c.section)) errors.push("Invalid/duplicate section");
    seen.add(c.section);
    if (c.executionStatus!=="NOT_EXECUTED" || !allowed.has(c.stage131Classification)) errors.push("Unfounded UAT claim in section "+c.section);
    if (!c.title || !c.minimumEvidence || !c.acceptanceMethod || !c.softwareSource || !t.gateRoles[c.primaryGate]) errors.push("Incomplete section "+c.section);
  }
  for(let i=1;i<=88;i++)if(!seen.has(i))errors.push("Section "+i+" missing");
  if(t?.candidatePreparation===F7_PRIVATE_PREP)errors.push(...f7TemplateErrors(t));
  return errors;
}
function evidenceErrors(m,t) {
  const errors=[];
  if (!obj(m)) return ["Evidence manifest must be a JSON object"];
  if(m.releaseCandidateSha!==t.releaseCandidateSha)errors.push("Unapproved/stale software SHA");
  if(m.environment!=="HOSTINGER_PRODUCTION")errors.push("Unverified Hostinger environment");
  if(m.openCriticalDefects!==0)errors.push("Critical defects not explicitly closed");
  if(!Array.isArray(m.cases)||m.cases.length!==88)errors.push("Evidence for all 88 sections required");
  const seen=new Set();
  for(const c of m.cases??[]) {
    if(!obj(c)){errors.push("Malformed case");continue;}
    if(!Number.isInteger(c.section)||c.section<1||c.section>88||seen.has(c.section))errors.push("Invalid/duplicate case");
    seen.add(c.section);
    if(c.status!=="PASS")errors.push("Section "+c.section+" not passed");
    if(!Array.isArray(c.evidence)||!c.evidence.length||c.evidence.some(e=>!obj(e)||!idOk(e.ref)||!sha256(e.sha256)))errors.push("Section "+c.section+" missing private SHA256 evidence");
    if(!idOk(c.executedBy)||!idOk(c.reviewedBy)||c.executedBy===c.reviewedBy)errors.push("Section "+c.section+" lacks independent operator/reviewer");
    if(!timeOk(c.executedAt)||!timeOk(c.reviewedAt)||Date.parse(c.reviewedAt)<Date.parse(c.executedAt))errors.push("Section "+c.section+" has invalid review timeline");
  }
  for(let i=1;i<=88;i++)if(!seen.has(i))errors.push("Section "+i+" missing actual review");
  errors.push(...f7EvidenceErrors(m,t));
  const gates=new Set(),reviewers=new Set();
  if(!Array.isArray(m.gateSignoffs)||m.gateSignoffs.length!==7)errors.push("All seven independent gate decisions required");
  for(const g of m.gateSignoffs??[]) {
    if(!obj(g)){errors.push("Malformed gate record");continue;}
    if(!Object.hasOwn(t.gateRoles,g.gateId??"")||gates.has(g.gateId))errors.push("Unknown/duplicate approval gate");
    gates.add(g.gateId);
    if(reviewers.has(g.reviewerId))errors.push("Gate signers must be seven independent people");
    reviewers.add(g.reviewerId);
    if(g.reviewerRole!==t.gateRoles[g.gateId]||g.decision!=="APPROVED"||!idOk(g.reviewerId)||!idOk(g.evidenceRef)||!timeOk(g.decidedAt))errors.push("Gate "+g.gateId+" lacks approval metadata");
  }
  for(const g of Object.keys(t.gateRoles))if(!gates.has(g))errors.push("Gate "+g+" missing");
  const owner=Array.isArray(m.gateSignoffs)
    ?m.gateSignoffs.find(g=>g?.gateId==="OWNER_FINAL"):null;
  if(owner && m.gateSignoffs.some(g=>g?.gateId!=="OWNER_FINAL"&&
     (!timeOk(g.decidedAt)||!timeOk(owner.decidedAt)||
      Date.parse(g.decidedAt)>Date.parse(owner.decidedAt))))
    errors.push("Final owner decision cannot predate independent domain signoffs");
  return errors;
}
function readJson(path){return JSON.parse(readFileSync(path,"utf8"));}
function main(){
  const templateIndex=process.argv.indexOf("--template");
  const suppliedTemplate=templateIndex>=0 ? process.argv[templateIndex+1] : null;
  if(templateIndex>=0 && (!suppliedTemplate || !isAbsolute(suppliedTemplate) ||
      process.argv.filter(x=>x==="--template").length!==1)){
    console.log("NO_GO: a single absolute private --template path is required");
    process.exitCode=1;return;
  }
  let t;
  try { t=readJson(suppliedTemplate || resolve(process.cwd(),"docs/STAGE_132_UAT_CASES.json")); }
  catch { console.log("NO_GO_TEMPLATE: private candidate template missing or invalid");process.exitCode=1;return; }
  const violations=templateErrors(t);
  if(violations.length){console.log("NO_GO_TEMPLATE: "+violations.join("; "));process.exitCode=1;return;}
  if(process.argv[2]==="--check-template"){console.log("TEMPLATE_VALID: 88/88 NOT_EXECUTED, 7 qualified gates; no real-world PASS claimed.");return;}
  if(process.argv[2]!=="--assess"||!process.argv[3]){console.error("Use --check-template or --assess /private/evidence.json");process.exitCode=2;return;}
  // Private candidates require positive, exact-release deployment metadata.
  // This checks structure and traceability only; it never authenticates evidence.
  if(t.candidatePreparation==="PRIVATE_UNVERIFIED_MAIN_CI_HOSTINGER_AND_HUMAN_UAT_PENDING"){
    const d=t.deploymentVerification;
    if(t.ownerConfirmedDeployment!=="HOSTINGER_EXACT_SHA_ATTESTED" ||
      !obj(d) || d.deployedSha!==t.releaseCandidateSha ||
      d.mainCiSha!==t.releaseCandidateSha ||
      !Number.isSafeInteger(d.mainCiRunId) || d.mainCiRunId<1 ||
      !idOk(d.reviewedBy) || !idOk(d.evidenceRef) || !timeOk(d.reviewedAt)){
      console.log("NO_GO: matching main CI and Hostinger deployment attestation metadata required for this exact candidate SHA");
      process.exitCode=1;return;
    }
  } else if(t.ownerConfirmedDeployment==="NOT_VERIFIED") {
    console.log("NO_GO: release-candidate Hostinger deployment has not been independently confirmed");
    process.exitCode=1;return;
  }
  let m;try{m=readJson(resolve(process.argv[3]));}catch{console.log("NO_GO: private evidence missing or invalid JSON");process.exitCode=1;return;}
  const errors=evidenceErrors(m,t);
  if(errors.length){console.log("NO_GO_MISSING_OR_INVALID_EVIDENCE: "+errors.length+" issue(s)\n"+errors.slice(0,25).join("\n"));process.exitCode=1;return;}
  console.log("METADATA_COMPLETE_REQUIRES_HUMAN_SIGNOFF: structural 88-case and 7-gate index present. This is NOT evidence authentication, device qualification, financial reconciliation, clinical release or GO.");
}
main();
