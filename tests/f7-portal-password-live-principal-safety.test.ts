import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("F7 password rotation: active patient/client/doctor and organization guarded after bcrypt",()=>{
  const route=readFileSync("src/app/api/portal/auth/change-password/route.ts","utf8");
  const hash=route.indexOf("const passwordHash = await hash(password, 12)");
  const accountLock=route.indexOf("SELECT id,status FROM portal_accounts");
  const principalCheck=route.indexOf("const livePrincipal = await tx.$queryRaw");
  const sessionCheck=route.indexOf("const currentSession = await tx.portalSession.findFirst");
  const mutate=route.indexOf("tx.portalAccount.updateMany");
  const revoke=route.indexOf("tx.portalSession.updateMany");
  assert.ok(hash>=0 && accountLock>hash && principalCheck>accountLock &&
    sessionCheck>principalCheck && mutate>sessionCheck && revoke>mutate,
    "post-hash principal check is mandatory before any password/session mutation");
  assert.match(route,/JOIN organizations o ON o.id=a.organization_id AND o.status='ACTIVE'/);
  assert.match(route,/p.id=\$\{session\.portalAccount\.patientId\}/);
  assert.match(route,/c.id=\$\{session\.portalAccount\.clientId\}/);
  assert.match(route,/r.id=\$\{session\.portalAccount\.referrerId\}/);
  assert.match(route,/p.status='ACTIVE' AND p.organization_id=a.organization_id/);
  assert.match(route,/c.status='ACTIVE' AND c.organization_id=a.organization_id/);
  assert.match(route,/r.status='ACTIVE' AND r.type='PHYSICIAN'/);
  assert.match(route,/r.organization_id=a.organization_id/);
  assert.match(route,/a.type=\$\{session\.portalAccount\.type\}/);
  assert.match(route,/livePrincipal.length !== 1/);
  assert.match(route,/throw new Error\("PORTAL_PASSWORD_PRINCIPAL_CHANGED"\)/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/otherSessionsRevoked: revoked.count/);
});

test("F7 password rotation: actual MariaDB revoked-subject regression must run in CI",()=>{
  const ci=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(ci,/Verify portal password live principal revocation in MariaDB/);
  assert.match(ci,/tests\/f7-portal-password-live-principal-mariadb.integration.test.ts/);
  assert.match(ci,/Verify portal password change revocation and disable race in MariaDB/);
});
