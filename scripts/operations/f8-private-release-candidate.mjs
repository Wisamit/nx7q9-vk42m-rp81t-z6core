#!/usr/bin/env node
// Prepare a private, UNVERIFIED final-UAT candidate, never a go-live approval.
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { F7_SCENARIOS } from "../f7-browser-evidence-integrity.mjs";

const root = realpathSync(process.cwd());
const within = (parent, child) => {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
};
const shaOk = value => typeof value === "string" &&
  /^[a-f0-9]{40}$/i.test(value) && !/^0{40}$/.test(value);

function main() {
  const args = process.argv.slice(2);
  if(args.length !== 4 || args[0] !== "--sha" || args[2] !== "--out") {
    console.error("Use --sha <exact-40-hex-main-commit> --out /private/f8-candidate.json");
    process.exitCode = 2;
    return;
  }
  const sha = args[1], target = args[3];
  if(!shaOk(sha) || !isAbsolute(target)) {
    console.error("F8_PREP_DENIED_INVALID_SHA_OR_PRIVATE_PATH");
    process.exitCode = 1;
    return;
  }
  let realParent;
  try { realParent = realpathSync(dirname(target)); }
  catch { console.error("F8_PREP_DENIED_PRIVATE_DIRECTORY_REQUIRED"); process.exitCode=1; return; }
  if(within(root, realParent)) {
    console.error("F8_PREP_DENIED_PUBLIC_REPOSITORY_PATH");
    process.exitCode = 1;
    return;
  }
  const source = JSON.parse(readFileSync(resolve(root, "docs/STAGE_132_UAT_CASES.json"), "utf8"));
  if(source.stage !== 132 || source.stageStatus !== "NOT_EXECUTED" ||
      !Array.isArray(source.cases) || source.cases.length !== 88 ||
      Object.keys(source.gateRoles || {}).length !== 7 ||
      source.cases.some((c,i) => c.section !== i+1 || c.executionStatus !== "NOT_EXECUTED")) {
    console.error("F8_PREP_DENIED_INCOMPLETE_SCOPE_OR_UNVERIFIED_UAT_STATUS");
    process.exitCode = 1;
    return;
  }
  // F7 and F8 share ONE final privately reviewed acceptance campaign.
  // A prior automated screenshot capture is NOT a human PASS. Generate
  // exactly the six existing synthetic browser contexts for each known UI
  // route, but retain NOT_EXECUTED until independent private review.
  let f7;
  try {
    const manifest = JSON.parse(readFileSync(resolve(root,"docs/UI_ROUTE_MANIFEST.json"),"utf8"));
    const routes=manifest.routes;
    if(manifest.expectedRouteCount!==81 || !Array.isArray(routes) ||
       routes.length!==81 || F7_SCENARIOS.length!==6 ||
       new Set(F7_SCENARIOS).size!==6 ||
       new Set(routes.map(r=>r.route)).size!==81 ||
       routes.some(r=>typeof r.route!=="string" || !r.route.startsWith("/") ||
         typeof r.file!=="string" || !/^src\/app\/(?:.+\/)?page\.tsx$/.test(r.file) ||
         r.file.includes("..") ||
         !within(root,realpathSync(resolve(root,r.file)))))
      throw Error("f7_route_manifest_invalid");
    const cases=routes.flatMap(r=>F7_SCENARIOS.map(scenario=>({
      route:r.route,sourceFile:r.file,scenario,executionStatus:"NOT_EXECUTED",
    })));
    if(cases.length!==486)throw Error("f7_scenario_count_invalid");
    f7={state:"NOT_EXECUTED",routeManifest:"docs/UI_ROUTE_MANIFEST.json",
      routeCount:81,scenarioCount:6,caseCount:486,cases};
  } catch {
    console.error("F8_PREP_DENIED_F7_ROUTE_OR_SCENARIO_MANIFEST_INVALID");
    process.exitCode=1;
    return;
  }
  const candidate = {
    ...source,
    releaseCandidateSha: sha.toLowerCase(),
    originalStage132BaselineSha: source.releaseCandidateSha,
    ownerConfirmedDeployment: "NOT_VERIFIED",
    source: "docs/STAGE_132_UAT_CASES.json",
    stageStatus: "NOT_EXECUTED",
    candidatePreparation: "PRIVATE_UNVERIFIED_MAIN_CI_HOSTINGER_AND_HUMAN_UAT_PENDING",
    cases: source.cases.map(c => ({...c, executionStatus:"NOT_EXECUTED"})),
    f7VisualAcceptance:f7,
  };
  try {
    // Atomic exclusive creation; cannot clobber a previous private review.
    writeFileSync(target, JSON.stringify(candidate,null,2)+"\n", {flag:"wx",mode:0o600});
  } catch {
    console.error("F8_PREP_DENIED_EXISTING_OR_UNWRITABLE_DESTINATION");
    process.exitCode = 1;
    return;
  }
  console.log("F8_PRIVATE_CANDIDATE_CREATED_UNVERIFIED: F8 88/88 and F7 486/486 NOT_EXECUTED; 7 gates; no CI, Hostinger, clinical or owner approval certified.");
}
main();
