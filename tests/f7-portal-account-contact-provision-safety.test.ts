import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("F7 portal provisioning locks tenant before contact deduplication and account creation",()=>{
  const route=readFileSync("src/app/api/portal-accounts/route.ts","utf8");
  const transaction=route.indexOf("account = await prisma.$transaction(async tx =>");
  const lock=route.indexOf("SELECT id FROM organizations");
  const duplicate=route.indexOf("tx.portalAccount.findFirst");
  const create=route.indexOf("tx.portalAccount.create");
  const audit=route.indexOf("tx.auditEvent.create");
  assert.ok(transaction>0 && lock>transaction && duplicate>lock && create>duplicate && audit>create);
  assert.match(route,/AND status='ACTIVE'\s+FOR UPDATE/);
  assert.match(route,/organizationId: orgId/);
  assert.match(route,/normalizedEmail: email/);
  assert.match(route,/normalizedPhone: phone/);
  assert.match(route,/PORTAL_CONTACT_ALREADY_IN_USE/);
  assert.match(route,/portal_contact_already_in_use/);
  assert.match(route,/isolationLevel: "Serializable"/);
  assert.doesNotMatch(route,/await prisma.portalAccount.findFirst/);
  assert.match(route,/action: "PORTAL_ACCOUNT_PROVISIONED"/);
});

test("F7 account provisioning keeps MariaDB multi-connection uniqueness gate",()=>{
  const ci=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(ci,/Verify atomic portal contact provisioning in MariaDB/);
  assert.match(ci,/tests\/f7-portal-account-contact-provision-mariadb\.integration\.test\.ts/);
});
