import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("F7 portal password: explicit account row lock and live session check precede password mutation",()=>{
  const route=readFileSync("src/app/api/portal/auth/change-password/route.ts","utf8");
  const lock=route.indexOf("SELECT id,status FROM portal_accounts");
  const session=route.indexOf("tx.portalSession.findFirst(");
  const update=route.indexOf("tx.portalAccount.updateMany(");
  const revoke=route.indexOf("tx.portalSession.updateMany(");
  const audit=route.indexOf("tx.auditEvent.create(");
  assert.ok(lock>0 && session>lock && update>session && revoke>update && audit>revoke,
    "lock account, validate live token, rotate password, revoke other sessions, then audit");
  assert.match(route,/AND organization_id=\$\{session\.portalAccount\.organizationId\}/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/live\[0\]\.status !== "ACTIVE"/);
  assert.match(route,/portalAccountId: session\.portalAccountId,\s*revokedAt: null,\s*expiresAt: \{ gt: new Date\(\) \}/);
  assert.match(route,/status: "ACTIVE",\s*\},\s*data: \{ passwordHash, mustChangePassword: false \}/);
  assert.doesNotMatch(route,/data: \{[^}]*status: "ACTIVE"/,
    "password change cannot force-reactivate an administratively disabled account");
  assert.match(route,/id: \{ not: session\.id \}/,
    "the current session survives for the existing first-login UX");
  assert.match(route,/newValues: \{ otherSessionsRevoked: revoked\.count \}/);
  assert.match(route,/isolationLevel: "Serializable"/);
});

test("F7 portal password: MariaDB dead-session/disabled-principal regression required in CI",()=>{
  const ci=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(ci,/Verify portal password change revocation and disable race in MariaDB/);
  assert.match(ci,/tests\/f7-portal-password-revocation-mariadb\.integration\.test\.ts/);
  assert.match(ci,/Verify serialized OTP issuance in MariaDB/,
    "do not remove previously guarded OTP concurrency");
});
