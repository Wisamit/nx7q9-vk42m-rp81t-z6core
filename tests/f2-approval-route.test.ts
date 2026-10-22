import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(
  "src/app/api/catalog/imports/[id]/configuration-approval/route.ts","utf8");
const migration=readFileSync(
  "prisma/migrations/20261020221000_catalog_f2_signing_permissions/migration.sql","utf8");
test("F2: technical approval POST is credentialed, anti-CSRF, branch-scoped and immutable-audit-only",()=>{
  assert.match(source,/export async function POST\(/);
  assert.doesNotMatch(source,/export async function GET\(/);
  assert.match(source,/configuration_approval_json_required/);
  assert.match(source,/configuration_approval_cross_site/);
  assert.match(source,/configuration_approval_origin/);
  assert.match(source,/configuration_approval_too_large/);
  assert.match(source,/catalog\.configuration\.clinical\.sign/);
  assert.match(source,/catalog\.configuration\.financial\.sign/);
  assert.match(source,/domainReviewPermissions\(input\.domain,own\)/);
  assert.match(source,/domainReviewPermissions\(input\.domain,current\)/);
  assert.match(source,/mfaEnabled/);
  assert.match(source,/mfaConfirmedAt/);
  assert.match(source,/verifyTotp\(decryptSecret\(currentUser\.mfaSecretEncrypted\)/);
  assert.match(source,/SELECT id FROM organizations/);
  assert.match(source,/FOR UPDATE/);
  assert.match(source,/isolationLevel:"RepeatableRead"/);
  assert.match(source,/resolveClinicalImportScope\(/);
  assert.match(source,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(source,/verifyBranchScopedPolicyDraftHistory\(/);
  assert.match(source,/Object\.values\(draft\.proposal\)\.includes\("UNDECIDED"\)/);
  assert.match(source,/readF2EffectiveLiveObservations\(tx,scope,grantedBranchIds,byType,new Date\(\)\)/);
  assert.match(source,/f2GovernedReadinessPreview\(/);
  assert.match(source,/catalogDriftObservationToken\(/);
  assert.match(source,/verifyCatalogApprovalHistory\(/);
  assert.match(source,/createCatalogApprovalEvidence\(/);
  assert.match(source,/configuration_approval_distinct_domain_required/);
  assert.match(source,/action:"CATALOG_F2_CONFIGURATION_APPROVAL_SIGNED"/);
  assert.match(source,/sourceInstallationVerified:false,qualifiedHumanApprovalVerified:false/);
  assert.match(source,/liveApplyAuthorized:false,liveWrites:false/);
  assert.doesNotMatch(source,/(?:tx|prisma)\.(?:labTest|testComponent|referenceInterval|priceList|priceListItem|priceListPackageItem|testPanel|commercialPackage|unit|container)\.(?:update|create|upsert|delete)\(/);
});
test("F2: explicit sign permissions exist without automatic system-admin grants",()=>{
  assert.match(migration,/catalog\.configuration\.clinical\.sign/);
  assert.match(migration,/catalog\.configuration\.financial\.sign/);
  assert.doesNotMatch(migration,/role_permissions|SYSTEM_ADMIN/);
  assert.match(migration,/WHERE NOT EXISTS/);
});
