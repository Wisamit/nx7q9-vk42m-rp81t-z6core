import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
// @ts-expect-error Node ESM script is intentionally .mjs (no TS declaration).
import {inspectF7BrowserEvidence,F7_SCENARIOS} from "../scripts/f7-browser-evidence-integrity.mjs";

type Entry=Record<string,unknown>;
const manifest=JSON.parse(readFileSync("docs/UI_ROUTE_MANIFEST.json","utf8")) as {
  expectedRouteCount:number;routes:{route:string}[];
};
const create=()=>{
  const findings:Entry[]=manifest.routes.flatMap((row,i)=>F7_SCENARIOS.map(
    (scenario:string,n:number)=>({
      canonicalRoute:row.route,scenario,
      profile:n%2?"staff_en":"staff_ar",
      status:"SCREENSHOT_CAPTURED",issues:[],
      responseStatus:200,redirectedToLogin:false,
      htmlLanguage:scenario.split("-")[1],
      htmlDirection:scenario.includes("-ar-")?"rtl":"ltr",
      horizontalOverflow:false,uncaughtRuntimeErrorCount:0,
      renderedFormCount:1,renderedActionCount:1,visibleDialogCount:0,
      unlabeledInputCount:0,unlabeledActionCount:0,
      interactiveViewportClippingCount:0,dialogA11yIssueCount:0,
      evidenceImage:"synthetic-"+i+"-"+n+".png",
      visualHumanSignoff:"NOT_EXECUTED",
      modalInteractionSignoff:"NOT_EXECUTED",
      clinicalSafetySignoff:"NOT_EXECUTED",
      themePaletteSignoff:"NOT_EXECUTED",
      timezoneDateFormatSignoff:"NOT_EXECUTED",
      branchRoleSignoff:"NOT_EXECUTED",
    })));
  return {schemaVersion:1,
    state:"AUTOMATED_SCREENSHOT_EVIDENCE_ONLY_NOT_FINAL_UAT",
    canonicalRouteCount:81,scenarioCount:486,executedCaseCount:486,
    captures:486,casesRequiringReview:0,findings,
    ownerAcceptance:"NOT_EXECUTED",
    humanVisualSignoff:"NOT_EXECUTED",qualifiedClinicalGo:"NO_GO",
  };
};
const check=(e:ReturnType<typeof create>,m:typeof manifest=manifest)=>
  inspectF7BrowserEvidence(e,m,"synthetic-audit",{
    sha:"synthetic-sha",
    // A mock PNG metadata reader makes this a pure contract test; no claim
    // that any real screenshots were captured or visually inspected.
    fileInfo:()=>({file:true,symlink:false,bytes:1024,signature:true}),
  });

test("F7: 81 canonical routes x 6 scenarios give 486 unique capture inputs, never signoff",()=>{
  assert.equal(manifest.routes.length,81);
  const report=check(create());
  assert.equal(report.result,"F7_CAPTURE_SET_COMPLETE_NOT_VISUALLY_APPROVED",report.errors.join(","));
  assert.equal(report.observedUniqueCases,486);
  assert.equal(report.verifiedImageFiles,486);
  assert.equal(report.ownerVisualApproval,"NOT_EXECUTED");
  assert.equal(report.branchRoleInteractionApproval,"NOT_EXECUTED");
  assert.equal(report.clinicalFinancialOperationalGo,"NO_GO");
});

test("F7: no route, device, locale, redirected session or missing file is silently omitted",()=>{
  const missing=create();
  missing.findings.pop();
  assert.ok(check(missing).errors.includes("F7_INCOMPLETE_OR_DUPLICATED_CASE_LIST"));
  assert.ok(check(missing).errors.includes("F7_MISSING_CANONICAL_SCENARIO"));
  const duplicate=create();
  duplicate.findings[1]={...duplicate.findings[0]};
  assert.ok(check(duplicate).errors.includes("F7_DUPLICATE_ROUTE_SCENARIO"));
  const redirected=create();
  redirected.findings[0].status="REVIEW_REQUIRED";
  redirected.findings[0].issues=["REDIRECTED_TO_LOGIN"];
  assert.ok(check(redirected).errors.includes("F7_BROWSER_SCREENSHOTS_REQUIRE_REVIEW"));
  const malicious=create();
  malicious.findings[0].evidenceImage="../../real-patient.png";
  assert.ok(check(malicious).errors.includes("F7_UNSAFE_OR_DUPLICATE_EVIDENCE_FILENAME"));
  const corrupt=create();
  const damaged=inspectF7BrowserEvidence(corrupt,manifest,"synthetic-audit",{
    fileInfo:()=>({file:true,symlink:false,bytes:80,signature:false}),
  });
  assert.ok(damaged.errors.includes("F7_SCREENSHOT_FILE_INVALID"));
});

test("F7: reported green screenshots cannot conceal failed HTTP, locale, keyboard or A11y checks",()=>{
  const unsafeCases: Array<[string,unknown]> = [
    ["responseStatus",500],["responseStatus",302],
    ["htmlLanguage","en"],["htmlDirection","ltr"],
    ["redirectedToLogin",true],["horizontalOverflow",true],
    ["uncaughtRuntimeErrorCount",1],["unlabeledInputCount",1],
    ["unlabeledActionCount",1],["interactiveViewportClippingCount",1],
    ["dialogA11yIssueCount",1],["renderedActionCount",-1],
  ];
  for(const [field,value] of unsafeCases){
    const altered=create();
    altered.findings[0][field]=value;
    assert.ok(check(altered).errors.includes("F7_CAPTURE_METADATA_INVALID"),
      field+" must not pass when a forged green status hides a browser problem");
  }
  const missing=create();
  delete missing.findings[0].responseStatus;
  assert.ok(check(missing).errors.includes("F7_CAPTURE_METADATA_INVALID"));
  const en=create();
  en.findings[1].htmlLanguage="ar";
  assert.ok(check(en).errors.includes("F7_CAPTURE_METADATA_INVALID"));
});

test("F7: software screenshot collector cannot grant owner, clinical or branch-role approval",()=>{
  const forged=create();
  forged.ownerAcceptance="PASS";
  assert.ok(check(forged).errors.includes("F7_UNQUALIFIED_OWNER_OR_CLINICAL_PASS_FORBIDDEN"));
  const signed=create();
  signed.findings[0].visualHumanSignoff="PASS";
  assert.ok(check(signed).errors.includes("F7_CASE_PROVENANCE_OR_HUMAN_SIGNATURE_FORGED"));
  const sourceTamper=create();
  const m={...manifest,expectedRouteCount:80};
  assert.ok(check(sourceTamper,m).errors.includes("F7_CANONICAL_ROUTE_MANIFEST_INVALID"));
});

test("F7: ALL browser workflows are private, owner-triggered and use only synthetic staging",()=>{
  for(const p of [
    ".github/workflows/ui-browser-sweep.yml",
    ".github/workflows/ui-synthetic-browser-review.yml",
  ]){
    const workflow=readFileSync(p,"utf8");
    assert.ok(workflow.includes("workflow_dispatch:"),p);
    assert.ok(workflow.includes("github.event.repository.private == true"),p);
    assert.ok(workflow.includes("github.ref == 'refs/heads/main'"),p);
    assert.ok(workflow.includes("environment: ui-synthetic-staging"),p);
    assert.ok(workflow.includes("persist-credentials: false"),p);
    assert.ok(workflow.includes("retention-days: 2"),p);
    assert.ok(!workflow.includes("pull_request:"),p);
    assert.ok(!workflow.includes("\n  push:"),p);
  }
  const runner=readFileSync("scripts/ui-browser-evidence.mjs","utf8");
  assert.ok(runner.includes('dialogA11yIssueCount'));
  assert.ok(runner.includes("VISIBLE_DIALOG_ACCESSIBLE_NAME_OR_MODAL_MISSING"));
  assert.ok(runner.includes('el.getAttribute("aria-modal") !== "true"'));
  assert.ok(runner.includes("document.getElementById(id)?.textContent?.trim()"));
  assert.ok(runner.includes(String.raw`split(/\s+/)`),
    "aria-labelledby IDs must be split on whitespace, not on a literal backslash");
  assert.ok(!runner.includes(String.raw`split(/\\s+/)`));
  assert.ok(!runner.includes("page.click("));
  assert.ok(!runner.includes("page.fill("));
  const privateReview=readFileSync(".github/workflows/ui-synthetic-browser-review.yml","utf8");
  assert.ok(privateReview.includes("node scripts/f7-browser-evidence-integrity.mjs"));
  assert.ok(privateReview.includes("FL_UI_AUDIT_SYNTHETIC_ONLY"));
});
