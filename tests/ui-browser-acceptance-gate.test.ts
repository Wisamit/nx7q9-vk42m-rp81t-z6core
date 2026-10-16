import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {execFileSync} from "node:child_process";

const source=readFileSync("scripts/ui-browser-acceptance.mjs","utf8");
const manifest=JSON.parse(readFileSync("docs/UI_ROUTE_MANIFEST.json","utf8")) as {
  expectedRouteCount:number;routes:Array<{route:string}>;
};

test("Issue #265: all 81 routes explicitly require rendered browser evidence and exact dynamic fixtures",()=>{
  const output=execFileSync(process.execPath,["scripts/ui-browser-acceptance.mjs","--plan"],{
    encoding:"utf8",
  });
  const report=JSON.parse(output) as {
    total:number;missingFixtures:string[];allScreensUnreviewed:boolean;variants:string[];
  };
  assert.equal(report.total,manifest.expectedRouteCount);
  assert.equal(report.total,81);
  assert.equal(report.missingFixtures.length,
    manifest.routes.filter(row=>row.route.includes("[")).length);
  assert.equal(report.allScreensUnreviewed,true);
  assert.deepEqual(report.variants,[
    "desktop-en-light","desktop-ar-dark","mobile-en-light","mobile-ar-dark",
  ]);
});

test("Issue #265: no browser job may run against production or without synthetic authorization",()=>{
  assert.ok(source.includes("ISOLATED_SYNTHETIC_ONLY"));
  assert.ok(source.includes("assertSyntheticBase(process.env.UI_QA_BASE_URL)"));
  assert.ok(source.includes("Refusing production-like URL"));
  assert.ok(source.includes("Require at least two independent synthetic staff roles on two branches"));
  assert.ok(source.includes("A synthetic portal account is required."));
  assert.ok(source.includes("Staging must use HTTPS"));
  assert.ok(source.includes('const {chromium}=await import("playwright")'),
    "playwright must not be imported during ordinary CI safety plan");
  assert.ok(source.includes("CAPTURED_UNREVIEWED"),
    "a screenshot is not signed UX acceptance");
  assert.ok(source.includes('status:"NOT_SIGNED_OFF"'));
  assert.ok(source.includes('browserReview:"NOT_SIGNED_OFF"'));
  assert.ok(!source.includes("status=\"ACCEPTED\""));
});

test("Issue #265: protected routing must fail on redirected login instead of giving false screenshot credit",()=>{
  assert.ok(source.includes("finalPath!==entry.pathname"));
  assert.ok(source.includes("setStaffLocale(page,viewport.lang)"));
  assert.ok(source.includes('input[name="username"]'));
  assert.ok(source.includes('input[name="password"]'));
  assert.ok(source.includes("never bypass MFA"));
  assert.ok(source.includes("document.documentElement.scrollWidth-document.documentElement.clientWidth"));
  assert.ok(source.includes("status=\"NOT_EXECUTED\"")||
    source.includes('rendered:"NOT_EXECUTED"'));
});
