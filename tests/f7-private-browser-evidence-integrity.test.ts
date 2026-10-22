import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
// @ts-expect-error Node ESM script is intentionally .mjs (no TS declaration).
import {inspectF7BrowserEvidence,F7_SCENARIOS} from "../scripts/f7-browser-evidence-integrity.mjs";
// @ts-expect-error Node ESM browser network policy is intentionally .mjs.
import {isAllowedSyntheticNetworkRequest} from "../scripts/f7-synthetic-network-origin.mjs";

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
      navigationTargetMatched:true,documentFullyLoaded:true,
      documentBodyHasContent:true,visibleBusySurfaceCount:0,
      blockedCrossOriginNetworkCount:0,
      htmlLanguage:scenario.split("-")[1],
      htmlDirection:scenario.includes("-ar-")?"rtl":"ltr",
      htmlTheme:scenario.split("-")[2],
      horizontalOverflow:false,uncaughtRuntimeErrorCount:0,
      renderedFormCount:1,renderedActionCount:1,visibleDialogCount:0,
      unlabeledInputCount:0,unlabeledActionCount:0,
      interactiveViewportClippingCount:0,dialogA11yIssueCount:0,
      evidenceImage:"synthetic-"+i+"-"+n+".png",
      evidenceSha256:"f".repeat(64),
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
    fileInfo:(filename:string)=>{
      const n=Number(filename.match(/-(\d+)\.png$/)?.[1]);
      const device=[{width:1440,height:900},{width:1440,height:900},
        {width:390,height:844},{width:390,height:844},
        {width:820,height:1180},{width:820,height:1180}][n];
      return {file:true,symlink:false,bytes:1024,signature:true,
        width:device?.width,height:device?.height,sha256:"f".repeat(64)};
    },
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
    ["navigationTargetMatched",false],["documentFullyLoaded",false],
    ["documentBodyHasContent",false],["visibleBusySurfaceCount",1],
    ["visibleBusySurfaceCount",-1],
    ["blockedCrossOriginNetworkCount",1],["blockedCrossOriginNetworkCount",-1],
    ["htmlLanguage","en"],["htmlDirection","ltr"],["htmlTheme","dark"],
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

test("F7: exact staging browser origin policy blocks cross-origin HTTP, CDN and WebSocket egress",()=>{
  const origin="https://qa.familylab.example.test";
  for (const url of [
    "https://qa.familylab.example.test/",
    "https://qa.familylab.example.test/assets/app.js",
    "https://qa.familylab.example.test:443/api/session",
    "wss://qa.familylab.example.test/interface/socket",
  ]) assert.equal(isAllowedSyntheticNetworkRequest(url,origin),true,url);
  for (const url of [
    "http://qa.familylab.example.test/",
    "ws://qa.familylab.example.test/interface/socket",
    "https://qa.familylab.example.test:8443/api",
    "https://sub.qa.familylab.example.test/",
    "https://qa.familylab.example.test.evil.test/",
    "https://fonts.googleapis.com/css2",
    "wss://prod.familylab.example.test/device",
    "https://u:p@qa.familylab.example.test/",
    "data:text/plain,not-network",
    "javascript:alert(1)",
    "not a URL",
  ]) assert.equal(isAllowedSyntheticNetworkRequest(url,origin),false,url);
  const loopback="http://127.0.0.1:3041";
  assert.equal(isAllowedSyntheticNetworkRequest("ws://127.0.0.1:3041/socket",loopback),true);
  assert.equal(isAllowedSyntheticNetworkRequest("http://127.0.0.1:3041/health",loopback),true);
  assert.equal(isAllowedSyntheticNetworkRequest("http://127.0.0.1:3042/health",loopback),false);
  assert.equal(isAllowedSyntheticNetworkRequest("wss://127.0.0.1:3041/socket",loopback),false);
});

test("F7: PNG artifacts are bound to scenario viewport and SHA-256 content",()=>{
  const changedHash=create();
  changedHash.findings[0].evidenceSha256="0".repeat(64);
  assert.ok(check(changedHash).errors.includes("F7_SCREENSHOT_HASH_OR_DIMENSION_INVALID"));
  const missingHash=create();
  delete missingHash.findings[0].evidenceSha256;
  assert.ok(check(missingHash).errors.includes("F7_SCREENSHOT_HASH_OR_DIMENSION_INVALID"));
  const replacedImage=create();
  const wrongSize=inspectF7BrowserEvidence(replacedImage,manifest,"synthetic-audit",{
    fileInfo:()=>({file:true,symlink:false,bytes:1024,signature:true,
      width:390,height:844,sha256:"f".repeat(64)}),
  });
  assert.ok(wrongSize.errors.includes("F7_SCREENSHOT_HASH_OR_DIMENSION_INVALID"));
  assert.equal(wrongSize.verifiedImageFiles,162,
    "only 162 valid mobile screenshots may count as verified");
  const invalidFile=create();
  const broken=inspectF7BrowserEvidence(invalidFile,manifest,"synthetic-audit",{
    fileInfo:()=>({file:true,symlink:false,bytes:1024,signature:false,
      width:1440,height:900,sha256:"f".repeat(64)}),
  });
  assert.ok(broken.errors.includes("F7_SCREENSHOT_FILE_INVALID"));
  assert.equal(broken.verifiedImageFiles,0);
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
  assert.ok(runner.includes('document.documentElement.dataset.theme'),
    "a named dark/light scenario needs verified rendered theme state");
  assert.ok(runner.includes("evidenceSha256"),
    "each browser screenshot must be fingerprinted for the evidence integrity gate");
  assert.ok(runner.includes("context.addInitScript"),
    "the synthetic browser must override only the cosmetic profile theme");
  assert.ok(runner.includes(String.raw`split(/\s+/)`),
    "aria-labelledby IDs must be split on whitespace, not on a literal backslash");
  assert.ok(!runner.includes(String.raw`split(/\\s+/)`));
  assert.ok(!runner.includes("page.click("));
  assert.ok(!runner.includes("page.fill("));
  assert.ok(runner.includes('navigationTargetMatched'));
  assert.ok(runner.includes('document.fonts.status === "loaded"'));
  assert.ok(runner.includes("visibleBusySurfaceCount"));
  assert.ok(runner.includes('[role="progressbar"]:not([aria-valuenow])'),
    "determinate business progress bars cannot be mistaken for pending loading UI");
  assert.ok(runner.includes("document.body?.innerText?.trim()"),
    "visible page content must exclude hidden JS/script payloads");
  assert.ok(runner.includes("Synthetic screenshot output directory must be empty"));
  assert.ok(runner.includes('serviceWorkers:"block"'));
  assert.ok(runner.includes('context.route("**/*"'));
  assert.ok(runner.includes('context.routeWebSocket("**/*"'));
  assert.ok(runner.includes("isAllowedSyntheticNetworkRequest"));
  assert.ok(runner.includes("OFF_STAGING_NETWORK_EGRESS_BLOCKED"));
  assert.ok(runner.includes("blockedCrossOriginNetworkCount"));
  assert.ok(runner.includes("await socketRoute.connectToServer()"));
  assert.ok(runner.includes("await socketRoute.close()"));
  assert.ok(!runner.includes("requestRoute.fetch("),
    "off-origin requests must be aborted before any network fetch occurs");
  assert.ok(runner.includes("resolvedAriaName(el)"));
  assert.ok(runner.includes("document.getElementById(id)?.textContent?.trim()"),
    "stale aria-labelledby IDs must not count as accessible input or button names");
  assert.ok(!runner.includes('await page.waitForLoadState("load", {timeout:12000}).catch'),
    "document load timeout must no longer be silently ignored");
  const privateReview=readFileSync(".github/workflows/ui-synthetic-browser-review.yml","utf8");
  assert.ok(privateReview.includes("node scripts/f7-browser-evidence-integrity.mjs"));
  assert.ok(privateReview.includes("FL_UI_AUDIT_SYNTHETIC_ONLY"));
});
