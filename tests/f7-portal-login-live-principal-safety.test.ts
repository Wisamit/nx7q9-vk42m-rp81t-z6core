import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("F7 portal login: both failed and successful bcrypt paths revalidate live linked subject in DB",()=>{
  const src=readFileSync("src/app/api/portal/auth/login/route.ts","utf8");
  assert.equal((src.match(/const livePrincipal = await tx\.\$queryRaw/g)||[]).length,2);
  assert.equal((src.match(/PORTAL_LOGIN_PRINCIPAL_CHANGED/g)||[]).length,2);
  for(const part of ["JOIN organizations o ON o.id=a.organization_id AND o.status='ACTIVE'",
    "AND a.status IN ('ACTIVE','LOCKED') AND a.type=",
    "p.id=${account.patientId}","p.status='ACTIVE'","p.organization_id=a.organization_id",
    "c.id=${account.clientId}","c.status='ACTIVE'","c.organization_id=a.organization_id",
    "r.id=${account.referrerId}","r.status='ACTIVE'","r.type='PHYSICIAN'",
    "r.organization_id=a.organization_id"]){
    assert.equal(src.split(part).length-1,2,"both paths require: "+part);
  }
  // Two preexisting account-row locks + two new subject row locks.
  assert.equal((src.match(/FOR UPDATE/g)||[]).length,4);
  assert.equal((src.match(/r\.organization_id=a\.organization_id\)\s*\)\s*FOR UPDATE/g)||[]).length,2,
    "both linked-subject queries must retain their own row locks");
  const failure=src.indexOf("if (!ok) {");
  const failureGate=src.indexOf("PORTAL_LOGIN_PRINCIPAL_CHANGED",failure);
  const failureSideEffect=src.indexOf("failedLoginAttempts + 1",failure);
  assert.ok(failure>=0 && failureGate>failure && failureGate<failureSideEffect,
    "revoked principals cannot increment lockout counters or write failed audit");
  const success=src.indexOf("const token = newPortalToken()");
  const successGate=src.indexOf("PORTAL_LOGIN_PRINCIPAL_CHANGED",success);
  const session=src.indexOf("tx.portalSession.create(",success);
  assert.ok(success>0 && successGate>success && successGate<session,
    "revoked principals must not create a portal login session");
  assert.match(src,/portalLoginStillUniquelyOwned\(current, login, currentOwners\.map\(owner=>owner\.id\)\)/,
    "unique contact ownership remains required");
});

test("F7 portal login: live-principal denial is wired to an actual MariaDB CI test",()=>{
  const ci=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(ci,/Verify live portal login principal after bcrypt in MariaDB/);
  assert.match(ci,/tests\/f7-portal-login-live-principal-mariadb\.integration\.test\.ts/);
  assert.match(ci,/Verify concurrent OTP claims and retry limits in MariaDB/);
});
