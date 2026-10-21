import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const route=readFileSync(
  "src/app/api/catalog/imports/[id]/source-provenance/route.ts","utf8");
const migration=readFileSync(
  "prisma/migrations/20261021123000_catalog_f2_source_provenance_permission/migration.sql","utf8");
test("F2: separate tenant-locked verifier writes only signed source provenance audit",()=>{
  assert.match(route,/export async function POST\(/);
  assert.doesNotMatch(route,/export async function GET\(/);
  assert.match(route,/runIndependentMappingPreflight\(request,context/);
  assert.match(route,/verifyF2SourceProvenance\(/);
  assert.match(route,/F2_SOURCE_AUTHORITY_PUBLIC_KEY_PEM/);
  assert.match(route,/F2_TARGET_INSTALLATION_ID/);
  assert.match(route,/F2_SOURCE_AUTHORITY_VALID_FROM/);
  assert.match(route,/F2_SOURCE_AUTHORITY_VALID_TO/);
  assert.match(route,/getCurrentSession\(/);
  assert.match(route,/permissionSet\(session\)/);
  assert.match(route,/f2_provenance_permission_required/);
  assert.match(route,/f2_provenance_current_scope_denied/);
  assert.match(route,/f2_provenance_authority_unconfigured/);
  assert.match(route,/pricing\.manage/);
  assert.match(route,/catalog\.reference_ranges\.manage/);
  assert.match(route,/catalog\.configuration\.source_provenance\.verify/);
  assert.match(route,/new TextDecoder\("utf-8",\{fatal:true\}\)/);
  assert.match(route,/reader\.cancel\("too_large"\)/);
  assert.match(route,/catalogImportRow\.findMany\(/);
  assert.match(route,/take:5001/);
  assert.match(route,/organizationId:evidence\.organizationId/);
  assert.match(route,/action:"CATALOG_F2_SOURCE_PROVENANCE_RECORDED"/);
  assert.match(route,/masterWrites:false/);
  assert.doesNotMatch(route,/tx\.(?:labTest|testComponent|referenceInterval|priceList|priceListItem|priceListPackageItem|testPanel|commercialPackage|unit|container)\.(?:update|create|upsert|delete)\(/);
  assert.doesNotMatch(route,/function issueF2SourceProvenance|\.privateKey|createPrivateKey/);
  assert.doesNotMatch(route,/sourceInstallationVerified:true|operationalUseAuthorized:true/);
});
test("F2: source authority permission is opt-in, never implicit SYSTEM_ADMIN",()=>{
  assert.match(migration,/catalog\.configuration\.source_provenance\.verify/);
  assert.match(migration,/WHERE NOT EXISTS/);
  assert.doesNotMatch(migration,/role_permissions|SYSTEM_ADMIN/);
});
