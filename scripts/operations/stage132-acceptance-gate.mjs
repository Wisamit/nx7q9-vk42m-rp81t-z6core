#!/usr/bin/env node
// Structural metadata check ONLY; never a clinical, financial or regulatory GO decision.
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
const idOk = x => typeof x === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_:/.-]{2,159}$/.test(x);
const timeOk = x => typeof x === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
const obj = x => x !== null && typeof x === "object" && !Array.isArray(x);
const sha256 = x => typeof x === "string" && /^[0-9a-f]{64}$/i.test(x);
const allowed = new Set(["APPROVAL_DEPENDENT","SOFTWARE_READY","VENDOR_OR_REAL_WORLD_DEPENDENT","BUSINESS_RULE_OR_DATA_UNRESOLVED"]);
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
  const gates=new Set();
  if(!Array.isArray(m.gateSignoffs)||m.gateSignoffs.length!==7)errors.push("All seven independent gate decisions required");
  for(const g of m.gateSignoffs??[]) {
    if(!obj(g)){errors.push("Malformed gate record");continue;}
    if(!Object.hasOwn(t.gateRoles,g.gateId??"")||gates.has(g.gateId))errors.push("Unknown/duplicate approval gate");
    gates.add(g.gateId);
    if(g.reviewerRole!==t.gateRoles[g.gateId]||g.decision!=="APPROVED"||!idOk(g.reviewerId)||!idOk(g.evidenceRef)||!timeOk(g.decidedAt))errors.push("Gate "+g.gateId+" lacks approval metadata");
  }
  for(const g of Object.keys(t.gateRoles))if(!gates.has(g))errors.push("Gate "+g+" missing");
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
