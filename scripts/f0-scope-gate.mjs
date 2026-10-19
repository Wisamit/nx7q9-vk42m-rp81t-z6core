import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// F0 checks structural evidence; never label an unsworn clinical UAT as PASSED.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const exists=p=>typeof p==="string"&&!path.isAbsolute(p)&&
  !p.split("/").includes("..")&&fs.existsSync(path.join(root,p));
const phases=["F0","F1","F2","F3","F4","F5","F6","F7","F8"];
const riskIds=["FIN-001","CFG-087","MDB-088","LAB-075","TAX-086",
  "UI-265","TEST-088","RC-PIN","DR-OPS","UAT-250"];
function pageFiles(dir){
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>{
    if(d.name==="api")return [];
    const full=path.join(dir,d.name);
    if(d.isDirectory())return pageFiles(full);
    return d.name==="page.tsx"?[path.relative(root,full).split(path.sep).join("/")]:[];
  });
}
function history(){
  return fs.readFileSync(path.join(root,"docs/STAGE_131_FINAL_SOFTWARE_AUDIT_88.md"),"utf8")
    .split("\n").filter(s=>/^\|\s*\d+\s*\|/.test(s)).map(s=>{
      const c=s.split("|").map(x=>x.trim().replaceAll(String.fromCharCode(96),""));
      return {id:+c[1],title:c[2],source:c[3],test:c[4].startsWith("tests/")?c[4]:null,
        category:c[5],qualification:c[6]};
    });
}
export function f0ScopeGate({
  ledger=read("docs/F0_SCOPE_88_TRIAGE.json"),
  historical=history(),
  uat=read("docs/STAGE_132_UAT_CASES.json"),
  manifest=read("docs/UI_ROUTE_MANIFEST.json"),
}={}){
  const errors=[],warn=[];
  const check=(condition,message)=>{if(!condition)errors.push(message);};
  const entries=ledger.sectionEntries||[],risks=ledger.triagedRisks||[];
  check(ledger.schemaVersion===1&&ledger.phase==="F0","F0 phase metadata invalid");
  check(ledger.originalScope?.sectionCount===88&&/^[a-f0-9]{64}$/.test(ledger.originalScope.sha256),
    "Canonical source hash is missing");
  check(entries.length===88&&historical.length===88&&uat.cases?.length===88,
    "All three sets must contain 88 scope entries");
  check(JSON.stringify(ledger.phases)===JSON.stringify(phases),"F0-F8 fixed scope changed");
  check(ledger.routeScope?.ownerBrowserQA==="F7_ONLY_NOT_EXECUTED","Owner browser gate moved or falsely completed");
  check(ledger.uat?.clinicalGo==="NO_GO"&&ledger.uat?.sevenGates==="UNSIGNED",
    "Cannot invent medical or qualified approval");
  check(ledger.uat?.pinnedHistoricSha===uat.releaseCandidateSha,"Old qualified UAT SHA misreported");
  check(Object.keys(uat.gateRoles||{}).length===7,"Missing real UAT professional gate roles");
  const categories={},selectedTestGaps=[];
  for(let i=0;i<88;i++){
    const row=entries[i],old=historical[i],human=uat.cases?.[i];if(!row||!old||!human)continue;
    const n=i+1;
    check(row.section===n&&old.id===n&&human.section===n,"Missing/reordered section "+n);
    check(row.title===old.title&&row.title===human.title,"Wrong scope title "+n);
    check(row.sourceAnchor===old.source&&exists(row.sourceAnchor),"Missing code anchor "+n);
    check(row.historicalSoftwareClassification===old.category&&
      row.remainingQualification===old.qualification,"Changed historical evidence "+n);
    check(row.stage131SelectedTest===old.test,"Wrong selected test provenance "+n);
    if(row.stage131SelectedTest)
      check(exists(row.stage131SelectedTest)&&
        row.evidenceSelection==="SOURCE_AND_SELECTED_TEST_EXIST","Missing test anchor "+n);
    else{
      selectedTestGaps.push(n);
      check(row.evidenceSelection==="NO_SECTION_SPECIFIC_TEST_SELECTED_IN_STAGE131_MATRIX",
        "Hidden test mapping gap "+n);
    }
    categories[old.category]=(categories[old.category]||0)+1;
    check(row.currentSourceTestCoverage==="STATIC_ANCHOR_EXISTENCE_ONLY"&&
      row.closureState==="NOT_YET_SIGNED_OR_ACCEPTED","False implementation or human approval "+n);
    check(row.primaryAcceptanceGate===human.primaryGate&&
      row.requiredQualifiedRole===uat.gateRoles?.[human.primaryGate]&&
      row.minimumRealWorldEvidence===human.minimumEvidence&&
      row.acceptanceObjective===human.acceptanceObjective&&
      row.qualifiedUatState===human.executionStatus,
      "Human qualified evidence not faithfully retained "+n);
    check(phases.includes(row.assignedEngineeringPhase)&&
      !["F0","F7","F8"].includes(row.assignedEngineeringPhase),
      "Engineering phase absent "+n);
    check(row.ownerBrowserAcceptancePhase==="F7"&&row.qualifiedOperationalAcceptancePhase==="F8",
      "Owner UX and professional UAT conflated "+n);
  }
  check(JSON.stringify(selectedTestGaps)===JSON.stringify([9,18,29,72,81]),
    "Historic unselected section-specific tests changed without review");
  check(categories.APPROVAL_DEPENDENT===48&&categories.SOFTWARE_READY===5&&
    categories.VENDOR_OR_REAL_WORLD_DEPENDENT===31&&
    categories.BUSINESS_RULE_OR_DATA_UNRESOLVED===4,
    "History categories were inaccurately upgraded");
  check(risks.length>=10,"Material risks silently dropped");
  const ids=new Set();
  for(const risk of risks){
    check(typeof risk.id==="string"&&!ids.has(risk.id),"Duplicate or missing risk id");
    ids.add(risk.id);
    check(phases.includes(risk.phase)&&risk.phase!=="F0"&&risk.owner&&risk.severity&&
      risk.entry&&risk.exit&&risk.type,"Untriaged risk "+risk.id);
    check(["OPEN_TRIAGED","BLOCKED_EXTERNAL_TRIAGED","CLOSED_WITH_EVIDENCE"].includes(risk.status),
      "Unrecognized risk outcome "+risk.id);
    for(const evidence of risk.files||[])check(exists(evidence),"Risk "+risk.id+" missing "+evidence);
  }
  for(const id of riskIds)check(ids.has(id),"Required P1 or acceptance gate dropped: "+id);
  for(const n of [75,86,87,88])
    check(entries[n-1]?.historicalSoftwareClassification==="BUSINESS_RULE_OR_DATA_UNRESOLVED",
      "Unsafe silent clearance of §"+n);
  const actual=pageFiles(path.join(root,"src/app")).sort();
  const listed=(manifest.routes||[]).map(row=>row.file).sort();
  check(actual.length===81&&listed.length===81&&new Set(listed).size===81&&
    JSON.stringify(actual)===JSON.stringify(listed),"Canonical 81-route inventory drift");
  const statuses={};
  for(const row of uat.cases||[])statuses[row.executionStatus]=(statuses[row.executionStatus]||0)+1;
  if(uat.releaseCandidateSha!==ledger.auditedBaselineSha)
    warn.push("Existing qualified UAT register SHA is old; only repin for a true final RC");
  return {phase:"F0",baseline:ledger.auditedBaselineSha,sections:entries.length,
    sourceAnchors:entries.filter(row=>exists(row.sourceAnchor)).length,
    selectedTests:entries.filter(row=>row.stage131SelectedTest).length,
    missingSelectedTests:selectedTestGaps,historicCategories:categories,
    risks:risks.length,unassignedRisks:risks.filter(x=>!x.owner||!x.phase||!x.exit).length,
    pages:actual.length,uat:statuses,browser:"NOT_EXECUTED",clinicalGo:"NO_GO",
    evidenceLimits:"Source/test path presence is not end-to-end evidence, 81-route browser acceptance, clinical validation or actual MDB row parity.",
    errors,warnings:warn};
}
export function f0Markdown(r){
  return ["# F0 — Full 88-section traceability","",
    "Baseline SHA: "+r.baseline,"",
    "| Evidence | Result |","| --- | --- |",
    "| Scope rows | "+r.sections+"/88 |",
    "| Source existence | "+r.sourceAnchors+"/88 |",
    "| Selected historic test paths | "+r.selectedTests+"/88 |",
    "| Unselected direct test references | "+r.missingSelectedTests.join(", ")+" |",
    "| Assigned risks | "+r.risks+", unassigned "+r.unassignedRisks+" |",
    "| Route files | "+r.pages+"/81 (static only) |",
    "| Qualified UAT | "+JSON.stringify(r.uat)+" |",
    "| Clinical production GO | NO_GO |","",
    "## Historic evidence classes",
    ...Object.entries(r.historicCategories).map(([k,v])=>"- "+k+": "+v),
    "","## Validation failures",...r.errors.map(x=>"- "+x),
    "","## Warnings",...r.warnings.map(x=>"- "+x),
    "","**Limit:** "+r.evidenceLimits,""].join("\n");
}
const mode=process.argv[2];
if(mode&&process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const r=f0ScopeGate();
  if(mode==="--json")process.stdout.write(JSON.stringify(r,null,2)+"\n");
  else if(mode==="--markdown")process.stdout.write(f0Markdown(r));
  else if(mode==="--check"){
    process.stdout.write("F0: "+r.sections+"/88, "+r.risks+" triaged, "+r.errors.length+" failures\n");
    for(const msg of r.errors)process.stderr.write(msg+"\n");
  }else{process.stderr.write("Expected --check, --json or --markdown\n");process.exitCode=2;}
  if(r.errors.length)process.exitCode=1;
}
