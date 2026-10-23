import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("F7: OTP verification locks current patient/client/doctor principal and session before consumption",()=>{
  const src=readFileSync("src/app/api/portal/auth/contact-verification/verify/route.ts","utf8");
  const begin=src.indexOf("await prisma.$transaction(async tx => {");
  const lock=src.indexOf("FROM portal_accounts a",begin);
  const session=src.indexOf("FROM portal_sessions",lock);
  const claim=src.indexOf("tx.portalOtpChallenge.updateMany",session);
  const proof=src.indexOf("tx.portalContactVerification.create",claim);
  assert.ok(begin>=0 && lock>begin && session>lock && claim>session && proof>claim);
  assert.match(src,/LEFT JOIN patients p ON p.id=a.patient_id/);
  assert.match(src,/LEFT JOIN clients c ON c.id=a.client_id/);
  assert.match(src,/LEFT JOIN referrers r ON r.id=a.referrer_id/);
  assert.match(src,/a.status='ACTIVE' AND a.must_change_password=0/);
  assert.match(src,/p.status='ACTIVE' AND p.organization_id=a.organization_id/);
  assert.match(src,/c.status='ACTIVE' AND c.organization_id=a.organization_id/);
  assert.match(src,/r.status='ACTIVE' AND r.type='PHYSICIAN'/);
  assert.match(src,/AND r.organization_id=a.organization_id/);
  assert.equal((src.match(/FOR UPDATE/g)||[]).length,2,"both principal and session must be locked");
  assert.match(src,/AND revoked_at IS NULL AND expires_at>NOW\(3\)/);
  assert.match(src,/liveSession.length !== 1/);
  assert.match(src,/live.length !== 1/);
  assert.match(src,/status: "ACTIVE", mustChangePassword: false, email: currentDestination/);
  assert.match(src,/status: "ACTIVE", mustChangePassword: false, phone: currentDestination/);
  assert.match(src,/PORTAL_VERIFICATION_PRINCIPAL_CHANGED/);
  assert.match(src,/PORTAL_VERIFICATION_SESSION_REVOKED/);
  assert.match(src,/error: "portal_unauthorized"/);
  assert.match(src,/where: portalOtpAttemptGuard\(challenge, verifiedAt\)/,
    "preserve expiry/attempt/single-use race guard after principal checks");
});

test("F7: real two-connection MariaDB principal/session revocation is a required CI gate",()=>{
  const workflow=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(workflow,/Verify OTP live principal revocation in MariaDB/);
  assert.match(workflow,/f7-portal-otp-principal-revocation-mariadb\.integration\.test\.ts/);
  assert.match(workflow,/Verify serialized OTP issuance in MariaDB/);
  assert.match(workflow,/Verify concurrent OTP claims and retry limits in MariaDB/);
});
