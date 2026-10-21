import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const route=readFileSync(
  "src/app/api/catalog/imports/[id]/configuration-apply/route.ts","utf8");
const entry=readFileSync("src/lib/catalog-f2-apply-entry.ts","utf8");
const migration=readFileSync(
  "prisma/migrations/20261021162000_catalog_f2_apply_operator_permission/migration.sql","utf8");

test("F2: apply route rejects all caller-generated activation and signatory evidence",()=>{
  assert.match(route,/export async function POST\(/);
  assert.doesNotMatch(route,/export async function GET\(/);
  assert.match(route,/f2_apply_body_not_allowed/);
  assert.match(route,/f2_apply_cross_site/);
  assert.match(route,/permissionSet\(session\)/);
  assert.match(route,/catalog\.configuration\.apply/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/isolationLevel:"RepeatableRead"/);
  assert.match(route,/applyF2ConfigurationFromVerifiedDatabaseUnderLock\(/);
  assert.match(route,/new Date\(\)/);
  assert.doesNotMatch(route,/\.json\(\)|\.text\(\)|sourceInstallationVerified:true/);
});
test("F2: locked preflight binds source provenance, signed decisions, live scope, revision and MFA",()=>{
  for(const expected of [
    /loadF2VerifiedSourceReceiptUnderLock\(/,
    /validatePolicyReviewBatchScope\(tx,/,
    /allowGovernedValueDifferences:true/,
    /verifyBranchScopedPolicyDraftHistory\(/,
    /verifyCatalogApprovalHistory\(/,
    /readCatalogLiveObservations\(/,
    /catalogDriftObservationToken\(/,
    /executeF2GovernedApplicationUnderLock\(tx,/,
    /catalog\.configuration\.clinical\.sign/,
    /catalog\.configuration\.financial\.sign/,
    /catalog\.configuration\.apply/,
    /mfaEnabled/,
    /userBranchScope\.findMany\(/,
    /currentOperatorScopesVerified:true/,
    /independentlyVerifiedInstallationMapping:true/,
  ])assert.match(entry,expected);
  assert.doesNotMatch(entry,/req\.body|request\.json\(|request\.formData\(/);
  assert.doesNotMatch(entry,/process\.env\.F2_SKIP_PROVENANCE|ALLOW_UNSIGNED/);
});
test("F2: operator permission must be explicitly granted, not inherited from SYSTEM_ADMIN",()=>{
  assert.match(migration,/catalog\.configuration\.apply/);
  assert.doesNotMatch(migration,/role_permissions|SYSTEM_ADMIN/);
});
