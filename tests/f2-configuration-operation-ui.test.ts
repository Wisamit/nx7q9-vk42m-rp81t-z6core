import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const ui=readFileSync("src/components/f2-configuration-operation-form.tsx","utf8");
const page=readFileSync("src/app/catalog/expert-reviews/page.tsx","utf8");
const apply=readFileSync("src/app/api/catalog/imports/[id]/configuration-apply/route.ts","utf8");
const reverse=readFileSync("src/app/api/catalog/imports/[id]/configuration-reverse/route.ts","utf8");

test("F2: operator UI only appears for real signed-applicator scope",()=>{
  assert.match(page,/F2ConfigurationOperationForm/);
  assert.match(page,/grants\.has\("pricing\.manage"\)/);
  assert.match(page,/grants\.has\("catalog\.reference_ranges\.manage"\)/);
  assert.match(page,/catalog\.configuration\.apply/);
  assert.match(page,/catalog\.configuration\.reverse/);
  assert.match(page,/operations\.length>0&&<F2ConfigurationOperationForm/);
  assert.doesNotMatch(page,/sourceInstallationVerified:true/);
});

test("F2: execution UI is explicit and sends bodyless API requests only",()=>{
  assert.match(ui,/"use client"/);
  assert.match(ui,/const expectedWord=/);
  assert.match(ui,/confirmation===word/);
  assert.match(ui,/UUID\.test\(batchId\)/);
  assert.match(ui,/pending\.current/);
  assert.match(ui,/credentials:"same-origin"/);
  assert.match(ui,/method:"POST"/);
  assert.match(ui,/configuration-apply/);
  assert.match(ui,/configuration-reverse/);
  assert.match(ui,/verifiedResponse\(body,mode\)/);
  assert.doesNotMatch(ui,/Content-Length|sourceData|mfaCode|authorization:|sourceInstallationVerified|APP_ENCRYPTION_KEY/);
  assert.match(ui,/role="alert"/);
  assert.match(ui,/role="status"/);
});

test("F2: server refuses client-supplied execution data and locks the tenant",()=>{
  for(const route of [apply,reverse]){
    assert.match(route,/request\.body!==null/);
    assert.match(route,/FOR UPDATE/);
    assert.match(route,/RepeatableRead/);
    assert.match(route,/applyF2ConfigurationFromVerifiedDatabaseUnderLock/);
    assert.match(route,/cross_site/);
    assert.doesNotMatch(route,/request\.json\(|request\.formData\(|sourceInstallationVerified:true/);
  }
});
