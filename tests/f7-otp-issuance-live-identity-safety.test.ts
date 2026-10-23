import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const route=readFileSync(
  "src/app/api/portal/auth/contact-verification/request/route.ts","utf8"
);

test("F7 OTP reissue: post-hash transaction locks linked subject, tenant and the issuing session",()=>{
  const parent=route.indexOf("SELECT id,email,phone,must_change_password");
  const tenant=route.indexOf("JOIN organizations o ON o.id=a.organization_id AND o.status='ACTIVE'");
  const principal=route.indexOf("const livePrincipal = await tx.$queryRaw");
  const session=route.indexOf("const liveSession = await tx.$queryRaw");
  const replaced=route.indexOf("tx.portalOtpChallenge.findMany");
  const issued=route.indexOf("tx.portalOtpChallenge.create");
  const notification=route.indexOf("await enqueueNotification(tx,");
  assert.ok(parent>=0 && principal>parent && tenant>principal &&
    session>tenant && replaced>session && issued>replaced &&
    notification>issued,
    "no invalidation, creation or notification before live authorization");
  assert.match(route,/LEFT JOIN patients p ON p.id=a.patient_id/);
  assert.match(route,/LEFT JOIN clients c ON c.id=a.client_id/);
  assert.match(route,/LEFT JOIN referrers r ON r.id=a.referrer_id/);
  assert.match(route,/a.type=\$\{account\.type\}/);
  assert.match(route,/p.id=\$\{refId\}/);
  assert.match(route,/c.id=\$\{refId\}/);
  assert.match(route,/r.id=\$\{refId\}/);
  assert.match(route,/p.status='ACTIVE' AND p.organization_id=a.organization_id/);
  assert.match(route,/c.status='ACTIVE' AND c.organization_id=a.organization_id/);
  assert.match(route,/r.status='ACTIVE' AND r.type='PHYSICIAN'/);
  assert.match(route,/r.organization_id=a.organization_id/);
  assert.match(route,/AND a.status='ACTIVE' AND a.must_change_password=0/);
  assert.match(route,/FROM portal_sessions\s+WHERE id=\$\{session\.id\} AND portal_account_id=\$\{account\.id\}/);
  assert.match(route,/revoked_at IS NULL AND expires_at>NOW\(3\)\s+FOR UPDATE/);
  assert.match(route,/livePrincipal.length !== 1/);
  assert.match(route,/liveSession.length !== 1/);
  assert.match(route,/PORTAL_CONTACT_ISSUANCE_SESSION_REVOKED/);
  assert.match(route,/error: "portal_unauthorized" \}, \{ status: 401/);
});

test("F7 OTP reissue: hardened verification and current-session checks remain present",()=>{
  const verify=readFileSync("src/app/api/portal/auth/contact-verification/verify/route.ts","utf8");
  assert.match(verify,/portalOtpAttemptGuard\(challenge, verifiedAt\)/);
  assert.match(verify,/PORTAL_VERIFICATION_PRINCIPAL_CHANGED/);
  assert.match(verify,/PORTAL_VERIFICATION_SESSION_REVOKED/);
  assert.match(route,/checkRateLimit\(/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/portal_subject_changed/);
});

test("F7 OTP reissue: actual MariaDB revocation regression is mandatory in CI",()=>{
  const workflow=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(workflow,/Verify revoked identity and session block OTP issuance in MariaDB/);
  assert.match(workflow,/tests\/f7-otp-issuance-live-identity-mariadb\.integration\.test\.ts/);
  assert.match(workflow,/Verify serialized OTP issuance in MariaDB/);
  assert.match(workflow,/Verify concurrent OTP claims and retry limits in MariaDB/);
});
