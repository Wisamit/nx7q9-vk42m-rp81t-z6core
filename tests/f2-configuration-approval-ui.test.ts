import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const api=readFileSync(
  "src/app/api/catalog/imports/[id]/configuration-approval/status/route.ts","utf8");
const form=readFileSync("src/components/f2-configuration-approval-form.tsx","utf8");
const page=readFileSync("src/app/catalog/expert-reviews/page.tsx","utf8");
const catalog=readFileSync("src/app/catalog/page.tsx","utf8");
test("F2: signatory status is an independent scoped read, not an author import view",()=>{
  assert.match(api,/export async function GET\(/);
  assert.doesNotMatch(api,/export async function POST\(/);
  assert.match(api,/configuration\.clinical\.sign/);
  assert.match(api,/configuration\.financial\.sign/);
  assert.match(api,/permissionSet\(session\)/);
  assert.match(api,/mayInspect\(live\)/);
  assert.match(api,/originalBranches\.has\(branchGrant\.branchId\)/);
  assert.match(api,/status:"DRAFT"/);
  assert.match(api,/session\.user\.id===batch\.createdByUserId/);
  assert.match(api,/attestationStatus!=="VERIFIED"/);
  assert.match(api,/fieldContractStatus!=="COMPLETE_SOURCE_FIELD_PROJECTION"/);
  assert.match(api,/verifyCatalogApprovalHistory\(/);
  assert.match(api,/FOR UPDATE/);
  assert.match(api,/isolationLevel:"RepeatableRead"/);
  assert.match(api,/operationalReleaseApproved:false/);
  assert.match(api,/liveWrites:false/);
  assert.match(api,/private, no-store/);
  assert.doesNotMatch(api,/(?:tx|prisma)\.(?:labTest|priceListItem|referenceInterval)\.(?:create|update|upsert|delete)/);
  assert.doesNotMatch(api,/newValues:checked\.clinical|signerUserId:checked/);
});
test("F2: signatory page never assumes signatures apply masters; authenticators are not stored in the client",()=>{
  assert.match(page,/requirePermission\("catalog\.manage"\)/);
  assert.match(page,/permissionSet\(session\)/);
  assert.match(page,/catalog\.configuration\.clinical\.sign/);
  assert.match(page,/catalog\.configuration\.financial\.sign/);
  assert.match(page,/F2ConfigurationApprovalForm/);
  assert.match(page,/CatalogExpertReviewQueue/);
  assert.match(form,/method:"GET"/);
  assert.match(form,/configuration-approval\/status/);
  assert.match(form,/method:"POST"/);
  assert.match(form,/expectedRevision:status\.revision/);
  assert.match(form,/mfaCode:totp/);
  assert.match(form,/setTotp\(""\)/);
});
test("F2: catalog keeps its canonical independent review page and signer controls",()=>{
  assert.match(catalog,/\/catalog\/expert-reviews/);
  assert.match(page,/catalog\.reference_ranges\.manage/);
  assert.match(page,/pricing\.manage/);
  assert.match(page,/F2ConfigurationApprovalForm/);
});
