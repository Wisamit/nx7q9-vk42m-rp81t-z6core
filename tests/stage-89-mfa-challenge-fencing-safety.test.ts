import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canFinalizeMfaChallenge } from "../src/lib/mfa-challenge-fencing.ts";

const now = new Date("2026-10-12T08:00:00.000Z");
const candidate = {
  consumedAt: null, expiresAt: new Date(now.getTime()+60_000),
  createdAt: new Date(now.getTime()-60_000),
  passwordChangedAt: null, userStatus:"ACTIVE",
  organizationStatus:"ACTIVE", mfaEnabled:true, hasSecret:true,
};

test("Stage 89: MFA challenge is invalid after use, expiration or password rotation",()=>{
  assert.equal(canFinalizeMfaChallenge(candidate,now),true);
  assert.equal(canFinalizeMfaChallenge({...candidate,consumedAt:now},now),false);
  assert.equal(canFinalizeMfaChallenge({...candidate,expiresAt:now},now),false);
  assert.equal(canFinalizeMfaChallenge({...candidate,passwordChangedAt:new Date(now.getTime()-30_000)},now),false);
  assert.equal(canFinalizeMfaChallenge({...candidate,passwordChangedAt:candidate.createdAt},now),false);
  assert.equal(canFinalizeMfaChallenge({...candidate,passwordChangedAt:new Date(now.getTime()-120_000)},now),true);
  assert.equal(canFinalizeMfaChallenge({...candidate,userStatus:"SUSPENDED"},now),false);
  assert.equal(canFinalizeMfaChallenge({...candidate,organizationStatus:"INACTIVE"},now),false);
  assert.equal(canFinalizeMfaChallenge({...candidate,mfaEnabled:false},now),false);
  assert.equal(canFinalizeMfaChallenge({...candidate,hasSecret:false},now),false);
  assert.equal(canFinalizeMfaChallenge({...candidate,createdAt:new Date(now.getTime()+1000)},now),false);
});

test("Stage 89: MFA verification fences row locks, recovers only one OTP and never writes a session before conditional claim",()=>{
  const route=readFileSync("src/app/api/auth/mfa/verify/route.ts","utf8");
  const password=readFileSync("src/app/api/security/profile/password/route.ts","utf8");
  const admin=readFileSync("src/app/api/admin/users/[id]/reset-password/route.ts","utf8");
  const userLock=route.indexOf("SELECT id FROM users WHERE id = ${pending.userId} FOR UPDATE");
  const challengeLock=route.indexOf("SELECT id FROM staff_mfa_challenges WHERE id = ${pending.id}");
  const recovery=route.indexOf("consumeRecoveryCode(code, remainingRecoveryCodes)");
  const claim=route.indexOf("await tx.staffMfaChallenge.updateMany({");
  const session=route.indexOf("await tx.userSession.create({");
  const audit=route.indexOf('action: "LOGIN_SUCCEEDED_MFA"');
  assert.ok(userLock>=0 && challengeLock>userLock);
  assert.ok(recovery>challengeLock && claim>recovery && session>claim && audit>session);
  assert.match(route,/claimed\.count !== 1/);
  assert.match(route,/consumedAt: null, expiresAt: \{ gt: new Date\(\) \}/);
  assert.match(route,/canFinalizeMfaChallenge/);
  assert.match(route,/passwordChangedAt: challenge\.user\.passwordChangedAt/);
  assert.match(route,/isolationLevel: "Serializable"/);
  assert.match(route,/scope: "staff_mfa_verify"/);
  assert.match(route,/MFA_VERIFICATION_FAILED/);
  assert.match(route,/where: \{ id: pending\.id \}/);
  assert.match(password,/await tx\.staffMfaChallenge\.updateMany/);
  assert.match(password,/where: \{ userId, consumedAt: null \}/);
  assert.match(admin,/await tx\.staffMfaChallenge\.updateMany/);
  assert.doesNotMatch(route,/mfaRecoveryCodes: remainingRecoveryCodes,[\s\S]*await prisma\.\$transaction\(\[/);
});
