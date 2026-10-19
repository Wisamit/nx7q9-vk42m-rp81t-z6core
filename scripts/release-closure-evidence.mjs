/**
 * Release-closure EVIDENCE, not a clinical/go-live approval.
 * CI validates repository coverage and records why qualified UAT stays NO_GO.
 * Historical Stage131 categories are faithfully reported, never promoted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const exists = name => fs.existsSync(path.join(root, name));
const matrixFile = "docs/STAGE_131_FINAL_SOFTWARE_AUDIT_88.md";
const uatFile = "docs/STAGE_132_UAT_CASES.json";
const uiFile = "docs/UI_ROUTE_MANIFEST.json";

function sourceRows() {
  return read(matrixFile).split("\n").filter(line => /^\|\s*\d+\s*\|/.test(line)).map(line => {
    const c = line.split("|").map(value => value.trim().replaceAll("`", ""));
    return { section: Number(c[1]), name: c[2], source: c[3],
      test: c[4], classification: c[5], unresolved: c[6] };
  });
}
function checkConsecutive(rows, field, count, errors, name) {
  if (!Array.isArray(rows) || rows.length !== count) {
    errors.push(name + ": expected " + count + " entries."); return;
  }
  for (let n=0; n<count; n++)
    if (rows[n]?.[field] !== n+1) errors.push(name + ": missing or reordered section " + (n+1));
}
function actualPages(folder) {
  return fs.readdirSync(folder, {withFileTypes:true}).flatMap(entry => {
    if (entry.name === "api") return [];
    const target=path.join(folder,entry.name);
    if (entry.isDirectory())return actualPages(target);
    return entry.name === "page.tsx"
      ? [path.relative(root,target).split(path.sep).join("/")] : [];
  });
}

export function releaseClosureEvidence() {
  const errors = [], warnings = [];
  const rows = sourceRows();
  checkConsecutive(rows,"section",88,errors,"88-scope matrix");
  const config = JSON.parse(read(uatFile));
  checkConsecutive(config.cases,"section",88,errors,"Stage132 actual-UAT register");
  const manifest = JSON.parse(read(uiFile));
  const pages = actualPages(path.join(root,"src","app")).sort();
  const mapped = (manifest.routes || []).map(row=>row.file).sort();
  if(manifest.expectedRouteCount!==81 || manifest.routes?.length!==81 ||
     pages.length!==81 || new Set(mapped).size!==81 ||
     pages.some((name,index)=>name!==mapped[index]))
    errors.push("81-route manifest does not exactly match current page sources.");
  const testsWithoutSectionSuite = [], sourceMissing = [];
  const categories = {};
  for (const row of rows) {
    categories[row.classification] = (categories[row.classification]||0)+1;
    if (!row.source.startsWith("src/") || !exists(row.source)) {
      sourceMissing.push({section:row.section,path:row.source});
      errors.push("Missing section " + row.section + " code anchor: " + row.source);
    }
    if (!row.test.startsWith("tests/") || !exists(row.test))
      testsWithoutSectionSuite.push({section:row.section,note:row.test});
  }
  const uatStates={};
  for(const row of config.cases || []) {
    uatStates[row.executionStatus]=(uatStates[row.executionStatus]||0)+1;
    if(!row.executionStatus || !row.primaryGate || !row.minimumEvidence)
      errors.push("Incomplete UAT metadata for section " + row.section);
  }
  const uiAudit=JSON.parse(execFileSync(process.execPath,
    [path.join(root,"scripts/ui-full-surface-audit.mjs"),"--json"],
    {encoding:"utf8",maxBuffer:10*1024*1024}));
  if(uiAudit.routesInspected!==81 || uiAudit.violations.length)
    errors.push("Static UI coverage did not pass the canonical 81-route policy.");
  if(uiAudit.totalUiComponents<1)errors.push("UI graph unexpectedly empty.");
  const pendingRules=rows.filter(row=>row.classification==="BUSINESS_RULE_OR_DATA_UNRESOLVED")
    .map(row=>({section:row.section,title:row.name,reason:row.unresolved}));
  const unexecuted=(config.cases||[]).filter(x=>x.executionStatus!=="PASS").length;
  const qualifiedUat=unexecuted===0 && Array.isArray(config.gateSignoffs) &&
    config.gateSignoffs.length===7;
  if (config.releaseCandidateSha !== (process.env.GITHUB_SHA || config.releaseCandidateSha))
    warnings.push("Stage132 UAT register is pinned to an older SHA; freeze actual release SHA for new qualified evidence.");
  return {
    schemaVersion:1,
    currentSourceSha:process.env.GITHUB_SHA || null,
    sourceMatrixBaseline:"Stage131 (historical classifications, not current clinical attestation)",
    previousUatReleaseCandidateSha:config.releaseCandidateSha,
    automatedCoverage: {
      sourceSections:rows.length, missingCodeAnchors:sourceMissing.length,
      existingSourceAnchors:rows.length-sourceMissing.length,
      categories, sectionsWithoutDirectTestSelected:testsWithoutSectionSuite,
      ciTestFiles:fs.readdirSync(path.join(root,"tests")).filter(x=>/\.test\.ts$/.test(x)).length,
      uiRouteSources:pages.length, uiComponentsInspected:uiAudit.totalUiComponents,
      potentialInlineForms:uiAudit.uniquePotentialInlineForms,
      ownerClinicalSecurityUiDecisions:uiAudit.ownerDecisionCandidates,
      dateTimeCallsRequiringBrowserReview:uiAudit.uniqueDateTimeCallsites,
    },
    unresolvedMasterScopeRules:pendingRules,
    acceptance: {
      qualifiedCasesNotPassed:unexecuted, stateCounts:uatStates,
      browser81RouteRealExecution:"NOT_EXECUTED",
      uiOwnerSignoff:"NOT_EXECUTED",
      clinicalFinanceDeviceRestoreSignoff:qualifiedUat?"METADATA_REQUIRES_INDEPENDENT_VERIFICATION":"NOT_EXECUTED",
      finalDecision:"NO_GO",
    },
    errors,warnings,
    policy:"Code anchors/static checks are NOT end-to-end browser, clinical, financial, device or restore evidence.",
  };
}

function asMarkdown(report) {
  const a=report.automatedCoverage, u=report.acceptance;
  return [
    "# Family Lab — frozen-scope software closure evidence",
    "",
    "Source SHA: `"+(report.currentSourceSha||"local/unpinned")+"`",
    "Original Master Scope: **88 sections, no removal**.",
    "",
    "| Gate | Evidence | Current outcome |",
    "| --- | --- | --- |",
    "| Source anchor coverage | "+a.existingSourceAnchors+"/"+a.sourceSections+" | static only |",
    "| Routes mapped | "+a.uiRouteSources+"/81 | source inventory only |",
    "| UI graph | "+a.uiComponentsInspected+" components; "+a.potentialInlineForms+" possible inline forms | browser review pending |",
    "| Date/time callsites | "+a.dateTimeCallsRequiringBrowserReview+" | org settings/browser verification pending |",
    "| Direct section-specific suites absent from Stage131 matrix | "+a.sectionsWithoutDirectTestSelected.length+" | confirm via refreshed regression mapping |",
    "| Qualified UAT cases not passed | "+u.qualifiedCasesNotPassed+"/88 | NOT EXECUTED |",
    "| Final clinical/finance/device/DR GO | NO_GO | requires real signed evidence |",
    "",
    "## Four policy/data blocks (no automatic approval)",
    ...report.unresolvedMasterScopeRules.map(x=>"- §"+x.section+" — "+x.title+": "+x.reason),
    "",
    "## Missing historical direct section-specific references",
    ...(a.sectionsWithoutDirectTestSelected.map(x=>"- §"+x.section+" — "+x.note)),
    "",
    "## Pending owner/clinical/security UI decisions",
    ...a.ownerClinicalSecurityUiDecisions.map(x=>"- "+x.file+":"+x.line+" — "+x.reason),
    "",
    "This machine-produced matrix is not interactive QA or a production GO decision.",
    "",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const evidence=releaseClosureEvidence();
    if(process.argv.includes("--json"))console.log(JSON.stringify(evidence,null,2));
    else if(process.argv.includes("--markdown"))console.log(asMarkdown(evidence));
    else console.log("Release source coverage: " + evidence.automatedCoverage.existingSourceAnchors +
      "/88; UI routes: " + evidence.automatedCoverage.uiRouteSources +
      "/81; qualified UAT NOT_EXECUTED; clinical GO: NO_GO.");
    if(evidence.errors.length) {
      console.error(evidence.errors.join("\n"));process.exitCode=1;
    }
    // Never treat a --check (static verification) as product release acceptance.
    if(process.argv.includes("--require-production-go")) {
      console.error("NO_GO: real qualified clinical/finance/device/DR and UI acceptance missing.");
      process.exitCode=1;
    }
  }catch(error){console.error(error);process.exitCode=1;}
}
