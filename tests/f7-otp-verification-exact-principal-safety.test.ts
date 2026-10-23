import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("F7 OTP verification: post-bcrypt DB lock requires exact tenant, type and original linked person",()=>{
  const api=readFileSync("src/app/api/portal/auth/contact-verification/verify/route.ts","utf8");
  const live=api.slice(api.indexOf("const live = await tx.$queryRaw"),api.indexOf("if (live.length !== 1)"));
  assert.match(live,/JOIN organizations o ON o\.id=a\.organization_id AND o\.status='ACTIVE'/);
  assert.match(live,/a\.type=\$\{account\.type\}/);
  assert.match(live,/p\.id=\$\{account\.patientId\}/);
  assert.match(live,/c\.id=\$\{account\.clientId\}/);
  assert.match(live,/r\.id=\$\{account\.referrerId\}/);
  assert.match(live,/p\.status='ACTIVE'/);
  assert.match(live,/c\.status='ACTIVE'/);
  assert.match(live,/r\.status='ACTIVE' AND r\.type='PHYSICIAN'/);
  assert.match(live,/FOR UPDATE/);
  assert.ok(api.indexOf("const live = await tx.$queryRaw") <
    api.indexOf("tx.portalOtpChallenge.updateMany"),
    "the current principal must be verified before claiming the challenge");
  assert.ok(api.indexOf("const live = await tx.$queryRaw") <
    api.indexOf("tx.portalContactVerification.create"),
    "a stale patient or tenant cannot generate contact verification evidence");
  assert.match(api,/PORTAL_VERIFICATION_PRINCIPAL_CHANGED/);
  assert.match(api,/PORTAL_VERIFICATION_SESSION_REVOKED/);
  assert.match(api,/where: portalOtpAttemptGuard\(challenge, verifiedAt\)/);
});
test("F7 OTP verification: exact-principal MariaDB fixture runs in full CI",()=>{
  const workflow=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(workflow,/Verify OTP same-tenant linked principal after bcrypt in MariaDB/);
  assert.match(workflow,/f7-otp-verification-exact-principal-mariadb\.integration\.test\.ts/);
  assert.match(workflow,/Verify concurrent OTP claims and retry limits in MariaDB/);
  assert.match(workflow,/Verify serialized OTP issuance in MariaDB/);
});
