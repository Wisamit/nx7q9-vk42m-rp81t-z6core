/**
 * F7 *private* browser screenshot evidence integrity gate.
 *
 * This does not render a route or read protected DOM/screenshot text. It
 * checks completeness, uniqueness, provenance shape and local PNG files from
 * an already isolated SYNTHETIC staging Playwright run. Successful capture is
 * NOT an owner visual signoff and is NEVER a clinical/business go-live grant.
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
export const F7_SCENARIOS=[
  "desktop-ar-light","desktop-en-dark","mobile-ar-dark",
  "mobile-en-light","tablet-ar-light","tablet-en-dark",
];
const prefix=Buffer.from([137,80,78,71,13,10,26,10]);
const scenarioDimensions={desktop:{width:1440,height:900},
  mobile:{width:390,height:844},tablet:{width:820,height:1180}};

export function inspectF7BrowserEvidence(evidence,manifest,outputDir,options={}){
  const errors=[];
  const requiredRoutes=Array.isArray(manifest?.routes)
    ?manifest.routes.map(item=>item.route):[];
  const routeSet=new Set(requiredRoutes);
  const scenarios=new Set(F7_SCENARIOS);
  if(manifest?.expectedRouteCount!==81||requiredRoutes.length!==81||
     routeSet.size!==81||requiredRoutes.some(x=>typeof x!=="string"||!x.startsWith("/")))
    errors.push("F7_CANONICAL_ROUTE_MANIFEST_INVALID");
  if(evidence?.schemaVersion!==1||
     evidence?.state!=="AUTOMATED_SCREENSHOT_EVIDENCE_ONLY_NOT_FINAL_UAT"||
     evidence?.canonicalRouteCount!==81||evidence?.scenarioCount!==486||
     evidence?.executedCaseCount!==486||!Array.isArray(evidence?.findings))
    errors.push("F7_SCREENSHOT_EVIDENCE_SCHEMA_OR_COUNT_INVALID");
  if(evidence?.ownerAcceptance!=="NOT_EXECUTED"||
     evidence?.humanVisualSignoff!=="NOT_EXECUTED"||
     evidence?.qualifiedClinicalGo!=="NO_GO")
    errors.push("F7_UNQUALIFIED_OWNER_OR_CLINICAL_PASS_FORBIDDEN");

  const seen=new Set(),screens=new Set();
  let missing=0,verifiedImages=0,reportedReview=0;
  const list=Array.isArray(evidence?.findings)?evidence.findings:[];
  if(list.length!==486)errors.push("F7_INCOMPLETE_OR_DUPLICATED_CASE_LIST");
  const imgDir=path.join(outputDir,"screenshots");
  const fileInfo=options.fileInfo??((filename)=>{
    const p=path.join(imgDir,filename);
    const st=fs.lstatSync(p);
    // Do not follow symlinks into unrelated files while validating private
    // screenshot artifacts. A PNG must have the IHDR width/height fields.
    if(!st.isFile()||st.isSymbolicLink())
      return {file:false,symlink:st.isSymbolicLink(),bytes:st.size,
        signature:false,width:0,height:0,sha256:null};
    const data=fs.readFileSync(p);
    const signature=data.length>=24&&data.subarray(0,8).equals(prefix)&&
      data.readUInt32BE(8)===13&&data.toString("ascii",12,16)==="IHDR";
    return {file:true,symlink:false,bytes:st.size,signature,
      width:signature?data.readUInt32BE(16):0,
      height:signature?data.readUInt32BE(20):0,
      sha256:createHash("sha256").update(data).digest("hex")};
  });
  for(const entry of list){
    if(!entry||typeof entry!=="object"||!routeSet.has(entry.canonicalRoute)||
       !scenarios.has(entry.scenario)){
      errors.push("F7_UNKNOWN_ROUTE_OR_SCENARIO");continue;
    }
    const key=JSON.stringify([entry.canonicalRoute,entry.scenario]);
    if(seen.has(key)){errors.push("F7_DUPLICATE_ROUTE_SCENARIO");continue;}
    seen.add(key);
    if(typeof entry.profile!=="string"||!entry.profile.trim()||
       entry.ownerAcceptance==="PASS"||
       entry.visualHumanSignoff!=="NOT_EXECUTED"||
       entry.modalInteractionSignoff!=="NOT_EXECUTED"||
       entry.clinicalSafetySignoff!=="NOT_EXECUTED"||
       entry.themePaletteSignoff!=="NOT_EXECUTED"||
       entry.timezoneDateFormatSignoff!=="NOT_EXECUTED"||
       entry.branchRoleSignoff!=="NOT_EXECUTED"){
      errors.push("F7_CASE_PROVENANCE_OR_HUMAN_SIGNATURE_FORGED");
    }
    if(entry.status!=="SCREENSHOT_CAPTURED"||!Array.isArray(entry.issues)||
       entry.issues.length>0){
      reportedReview++;
    }
    // Never trust a caller-supplied SCREENSHOT_CAPTURED label over the
    // concrete read-only browser observations. All six locale/direction
    // contexts must agree with their captured DOM and accessibility counts.
    const expectedLocale=entry.scenario.split("-")[1];
    const expectedDirection=expectedLocale==="ar"?"rtl":"ltr";
    const observedCounts=[
      "uncaughtRuntimeErrorCount","renderedFormCount","renderedActionCount",
      "visibleDialogCount","unlabeledInputCount","unlabeledActionCount",
      "interactiveViewportClippingCount","dialogA11yIssueCount",
    ];
    const failureCounts=[
      "uncaughtRuntimeErrorCount","unlabeledInputCount","unlabeledActionCount",
      "interactiveViewportClippingCount","dialogA11yIssueCount",
    ];
    if(!Number.isInteger(entry.responseStatus)||entry.responseStatus<200||
       entry.responseStatus>=300||entry.redirectedToLogin!==false||
       entry.navigationTargetMatched!==true||
       entry.documentFullyLoaded!==true||entry.documentBodyHasContent!==true||
       !Number.isSafeInteger(entry.visibleBusySurfaceCount)||
       entry.visibleBusySurfaceCount!==0||
       !Number.isSafeInteger(entry.blockedCrossOriginNetworkCount)||
       entry.blockedCrossOriginNetworkCount!==0||
       typeof entry.htmlLanguage!=="string"||
       entry.htmlLanguage.toLowerCase().split("-")[0]!==expectedLocale||
       entry.htmlDirection!==expectedDirection||
       entry.htmlTheme!==entry.scenario.split("-")[2]||
       entry.horizontalOverflow!==false||
       observedCounts.some(key=>!Number.isSafeInteger(entry[key])||entry[key]<0)||
       failureCounts.some(key=>entry[key]!==0)){
      errors.push("F7_CAPTURE_METADATA_INVALID");
    }
    const filename=entry.evidenceImage;
    if(typeof filename!=="string"||
       filename==="."||filename===".."||
       !/^[A-Za-z0-9_-]+\.png$/.test(filename)||screens.has(filename)){
      errors.push("F7_UNSAFE_OR_DUPLICATE_EVIDENCE_FILENAME");continue;
    }
    screens.add(filename);
    try{
      const f=fileInfo(filename);
      if(!f.file||f.symlink||f.bytes<100||!f.signature){
        errors.push("F7_SCREENSHOT_FILE_INVALID");
      }else{
        const sizes=scenarioDimensions[entry.scenario.split("-")[0]];
        if(typeof entry.evidenceSha256!=="string"||
           !/^[0-9a-f]{64}$/.test(entry.evidenceSha256)||
           f.sha256!==entry.evidenceSha256||
           f.width!==sizes.width||
           !Number.isSafeInteger(f.height)||f.height<sizes.height){
          errors.push("F7_SCREENSHOT_HASH_OR_DIMENSION_INVALID");
        }else verifiedImages++;
      }
    }catch{missing++;}
  }
  for(const route of routeSet){
    for(const scenario of F7_SCENARIOS){
      if(!seen.has(JSON.stringify([route,scenario])))
        errors.push("F7_MISSING_CANONICAL_SCENARIO");
    }
  }
  if(missing)errors.push("F7_MISSING_PRIVATE_SCREENSHOT_FILES");
  if(reportedReview)errors.push("F7_BROWSER_SCREENSHOTS_REQUIRE_REVIEW");
  if(evidence?.captures!==486||evidence?.casesRequiringReview!==0)
    errors.push("F7_CAPTURE_TOTALS_INCONSISTENT");
  return {
    schemaVersion:1,
    exactSha:options.sha??process.env.GITHUB_SHA??null,
    routeCount:routeSet.size,expectedScenarioCount:486,
    observedUniqueCases:seen.size,verifiedImageFiles:verifiedImages,
    unresolvedBrowserCases:reportedReview,
    result:errors.length?"F7_CAPTURE_INTEGRITY_BLOCKED":
      "F7_CAPTURE_SET_COMPLETE_NOT_VISUALLY_APPROVED",
    ownerVisualApproval:"NOT_EXECUTED",
    branchRoleInteractionApproval:"NOT_EXECUTED",
    clinicalFinancialOperationalGo:"NO_GO",
    errors:[...new Set(errors)].sort(),
  };
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dir=process.env.FL_UI_AUDIT_OUTPUT_DIR||"ui-browser-evidence";
  try{
    const manifest=JSON.parse(fs.readFileSync(path.join(ROOT,"docs/UI_ROUTE_MANIFEST.json"),"utf8"));
    const evidence=JSON.parse(fs.readFileSync(path.join(dir,"ui-browser-evidence.json"),"utf8"));
    const report=inspectF7BrowserEvidence(evidence,manifest,dir);
    // Only aggregate categories/counts are written; never screen text,
    // credentials, patient identifiers or original screenshot contents.
    fs.writeFileSync(path.join(dir,"f7-capture-integrity.json"),
      JSON.stringify(report,null,2)+"\n",{flag:"wx",mode:0o600});
    console.log(JSON.stringify({result:report.result,cases:report.observedUniqueCases,
      images:report.verifiedImageFiles,clinicalGo:"NO_GO",issues:report.errors}));
    if(report.errors.length)process.exitCode=1;
  }catch{
    console.error("F7_CAPTURE_INTEGRITY_UNAVAILABLE_OR_REJECTED");
    process.exitCode=1;
  }
}
