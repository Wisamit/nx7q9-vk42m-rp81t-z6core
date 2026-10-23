import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { portalLoginStillUniquelyOwned } from "../src/lib/portal-login-identity.ts";

test("F7 login: current account must remain unique owner of submitted contact",()=>{
  const owner={id:"account-a",normalizedEmail:"current@example.invalid",normalizedPhone:null};
  assert.equal(portalLoginStillUniquelyOwned(owner,"current@example.invalid",["account-a"]),true);
  assert.equal(portalLoginStillUniquelyOwned({...owner,normalizedEmail:null},"current@example.invalid",["account-a"]),false);
  assert.equal(portalLoginStillUniquelyOwned(owner,"current@example.invalid",["account-b"]),false);
  assert.equal(portalLoginStillUniquelyOwned(owner,"current@example.invalid",["account-a","account-b"]),false);
  assert.equal(portalLoginStillUniquelyOwned(owner,"current@example.invalid",[]),false);
  assert.equal(portalLoginStillUniquelyOwned(owner,"other@example.invalid",["account-a"]),false);
  assert.equal(portalLoginStillUniquelyOwned(
    {...owner,normalizedPhone:"+971501112233"},"+971501112233",["account-a"]),true);
});

test("F7 login: neither failed nor successful bcrypt path may act on a revoked contact/tenant",()=>{
  const route=readFileSync("src/app/api/portal/auth/login/route.ts","utf8");
  assert.equal((route.match(/portalLoginStillUniquelyOwned\(current, login, currentOwners\.map\(owner=>owner\.id\)\)/g)||[]).length,2);
  assert.equal((route.match(/tx\.organization\.findUnique\(/g)||[]).length,2);
  assert.equal((route.match(/organization\?\.status !== "ACTIVE"/g)||[]).length,2);
  assert.equal((route.match(/tx\.portalAccount\.findMany\(/g)||[]).length,2);
  assert.equal((route.match(/take: 2,/g)||[]).length,2);
  assert.match(route,/const matches = await prisma\.portalAccount\.findMany/);
  assert.doesNotMatch(route,/portalAccount\.findFirst/);
  const bad=route.indexOf("if (!ok) {");
  const succeeded=route.indexOf("const token = newPortalToken()");
  const revalidate=route.indexOf("!portalLoginStillUniquelyOwned",succeeded);
  const session=route.indexOf("tx.portalSession.create");
  const failureAudit=route.indexOf('action: "PORTAL_LOGIN_FAILED"');
  assert.ok(bad>0 && route.indexOf("!portalLoginStillUniquelyOwned",bad)<failureAudit);
  assert.ok(revalidate>succeeded && revalidate<session,"verify live identity before creating session");
  assert.match(route,/isolationLevel: "Serializable"/);
  assert.match(route,/AND organization_id = \$\{account\.organizationId\} FOR UPDATE/);
});

test("F7 login: current-contact post-bcrypt MariaDB regression remains mandatory CI",()=>{
  const ci=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(ci,/Verify portal login rechecks live contact after bcrypt in MariaDB/);
  assert.match(ci,/tests\/f7-portal-login-transaction-identity-mariadb\.integration\.test\.ts/);
  assert.match(ci,/Verify tenant-safe portal login identity uniqueness in MariaDB/);
  assert.match(ci,/Verify atomic portal contact provisioning in MariaDB/);
});
