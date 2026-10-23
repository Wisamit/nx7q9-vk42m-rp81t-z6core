import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("F7 OTP request: parent account row lock precedes any challenge invalidation/creation",()=>{
  const route=readFileSync("src/app/api/portal/auth/contact-verification/request/route.ts","utf8");
  const lock=route.indexOf("SELECT id,email,phone,must_change_password");
  const revocations=route.indexOf("tx.portalOtpChallenge.findMany");
  const creation=route.indexOf("tx.portalOtpChallenge.create");
  const notification=route.indexOf("await enqueueNotification(tx,");
  assert.ok(lock>0&&revocations>lock&&creation>revocations&&notification>creation,
    "serialize concurrent OTP requesters before replacing and queuing a new code");
  assert.match(route,/FROM portal_accounts\s+WHERE id=\$\{account\.id\} AND organization_id=\$\{account\.organizationId\}/);
  assert.match(route,/AND status='ACTIVE'\s+FOR UPDATE/);
  assert.match(route,/current\?\.must_change_password/);
  assert.match(route,/currentDestination !== destination/);
  assert.match(route,/PORTAL_CONTACT_ISSUANCE_CHANGED/);
  assert.match(route,/error: "portal_subject_changed"/);
  assert.match(route,/consumedAt: null/);
  assert.match(route,/tx\.notification\.updateMany/);
  assert.match(route,/tx\.auditEvent\.create/);
});

test("F7 OTP request: real MariaDB concurrent replacement remains a mandatory CI gate",()=>{
  const workflow=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(workflow,/Verify serialized OTP issuance in MariaDB/);
  assert.match(workflow,/tests\/f7-portal-otp-request-race-mariadb\.integration\.test\.ts/);
  assert.match(workflow,/Verify concurrent OTP claims and retry limits in MariaDB/,
    "existing atomic OTP verification concurrency gate must remain");
});
