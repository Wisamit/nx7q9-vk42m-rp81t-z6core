import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hashSync, compareSync } from "bcryptjs";
import {
  isActiveSystemAdmin, passwordResetReason, staffCredentialTargetAllowed,
  validateStaffPassword,
} from "../src/lib/staff-password-policy.ts";

test("Stage 88: passwords cannot be truncated by bcrypt or silently mistyped", () => {
  const good="Clinic-NewPassphrase-123!";
  assert.equal(validateStaffPassword(good,good),null);
  assert.equal(validateStaffPassword("short","short"),"password_policy_failed");
  assert.equal(validateStaffPassword("x".repeat(73),"x".repeat(73)),"password_policy_failed");
  assert.equal(validateStaffPassword("ع".repeat(37),"ع".repeat(37)),"password_policy_failed");
  assert.equal(validateStaffPassword("SafePassword123!\u0000","SafePassword123!\u0000"),"password_policy_failed");
  assert.equal(validateStaffPassword(good,good+"bad"),"password_confirmation_mismatch");
  assert.equal(validateStaffPassword(null,good),"password_fields_required");
  assert.equal(passwordResetReason("Important recovery for offline staff"),"Important recovery for offline staff");
  assert.equal(passwordResetReason("short"),null);
  assert.equal(passwordResetReason("a".repeat(1001)),null);
  const current=hashSync("OriginalAccountSecret123!",12);
  assert.equal(compareSync("OriginalAccountSecret123!",current),true);
  assert.equal(compareSync(good,current),false);
});

test("Stage 88: credential reset requires separate active system administrator and same tenant",()=>{
  const yes={actorId:"admin",targetId:"staff",actorOrganizationId:"org1",
    targetOrganizationId:"org1",actorIsSystemAdmin:true,
    actorHasManagePermission:true,targetStatus:"ACTIVE"};
  assert.equal(staffCredentialTargetAllowed(yes),true);
  for(const changed of [
    {actorId:"staff",targetId:"staff"},
    {targetOrganizationId:"org2"},
    {actorIsSystemAdmin:false},
    {actorHasManagePermission:false},
    {targetStatus:"SUSPENDED"},
  ]) assert.equal(staffCredentialTargetAllowed({...yes,...changed}),false);
  assert.equal(isActiveSystemAdmin([{role:{code:"SYSTEM_ADMIN",status:"ACTIVE"}}]),true);
  assert.equal(isActiveSystemAdmin([{role:{code:"SYSTEM_ADMIN",status:"INACTIVE"}}]),false);
  assert.equal(isActiveSystemAdmin([{role:{code:"BRANCH_MANAGER",status:"ACTIVE"}}]),false);
});

test("Stage 88: browser and server prevent old password bypass, reauthenticate and revoke all sessions",()=>{
  const self=readFileSync("src/app/api/security/profile/password/route.ts","utf8");
  const reset=readFileSync("src/app/api/admin/users/[id]/reset-password/route.ts","utf8");
  const legacy=readFileSync("src/app/api/admin/users/[id]/route.ts","utf8");
  const page=readFileSync("src/app/security/page.tsx","utf8");
  const profile=readFileSync("src/components/security-settings.tsx","utf8");
  const management=readFileSync("src/components/user-management.tsx","utf8");
  const usersPage=readFileSync("src/app/users/page.tsx","utf8");
  assert.match(self,/getCurrentSession\(\)/);
  assert.match(self,/checkRateLimit/);
  assert.match(self,/validateStaffPassword/);
  assert.match(self,/SELECT id FROM users WHERE id = \$\{userId\}[\s\S]*FOR UPDATE/);
  assert.match(self,/compare\(currentPassword, user\.passwordHash\)/);
  assert.match(self,/compare\(fields\.newPassword as string, user\.passwordHash\)/);
  assert.match(self,/await tx\.userSession\.updateMany\(/);
  assert.match(self,/where: \{ userId, revokedAt: null \}/);
  assert.match(self,/STAFF_PASSWORD_CHANGED/);
  assert.match(self,/response\.cookies\.set\(SESSION_COOKIE, ""/);
  assert.match(reset,/permissionSet\(session\)\.has\("users\.manage"\)/);
  assert.match(reset,/isActiveSystemAdmin\(session\.user\.roles\)/);
  assert.match(reset,/actorPassword/);
  assert.match(reset,/compare\(actorPassword, actor\.passwordHash\)/);
  assert.match(reset,/active_branch_scope_required/);
  assert.match(reset,/organization_id = \$\{organizationId\} FOR UPDATE/);
  assert.match(reset,/staffCredentialTargetAllowed/);
  assert.match(reset,/await tx\.userSession\.updateMany/);
  assert.match(reset,/await tx\.staffMfaChallenge\.updateMany/);
  assert.match(reset,/STAFF_PASSWORD_ADMIN_RESET/);
  assert.match(reset,/isolationLevel: "Serializable"/);
  assert.match(legacy,/use_secure_password_reset_workflow/);
  assert.doesNotMatch(legacy,/passwordHash: await hash\(password/);
  assert.match(usersPage,/canResetPasswords=\{canResetPasswords\}/);
  assert.match(usersPage,/currentUserId=\{session\.user\.id\}/);
  assert.match(management,/resetStaffPassword/);
  assert.match(management,/user\.id !== currentUserId/);
  assert.match(profile,/fetch\("\/api\/security\/profile\/password"/);
  assert.match(profile,/window\.location\.assign\("\/login\?passwordChanged=1"\)/);
  assert.match(page,/SecuritySettings/);
  for(const route of [self,reset]) {
    assert.doesNotMatch(route,/passwordHash:.*newValues/);
    assert.doesNotMatch(route,/newValues: \{[\s\S]*?passwordHash/);
  }
});
