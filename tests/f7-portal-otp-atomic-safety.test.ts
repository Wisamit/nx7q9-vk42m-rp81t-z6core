import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {portalOtpAttemptGuard} from "../src/lib/portal-otp-attempt-guard.ts";

const challenge={
  id:"challenge-a",portalAccountId:"account-a",
  codeHash:"synthetic-bcrypt-hash",destination:"contact@example.invalid",
  maxAttempts:5,
};

test("F7 OTP: claim always enforces same challenge, destination, consumption, expiry and remaining budget",()=>{
  const now=new Date("2026-10-23T09:00:00.000Z");
  const guard=portalOtpAttemptGuard(challenge,now);
  assert.deepEqual(guard,{
    id:"challenge-a",
    portalAccountId:"account-a",
    purpose:"VERIFY_CONTACT",
    codeHash:"synthetic-bcrypt-hash",
    destination:"contact@example.invalid",
    consumedAt:null,
    expiresAt:{gt:now},
    attempts:{lt:5},
  });
  assert.notEqual(portalOtpAttemptGuard(challenge,new Date(now.getTime()+1)).expiresAt.gt,now);
});

test("F7 OTP: both wrong and correct responses use DB CAS rather than stale pre-read",()=>{
  const route=readFileSync("src/app/api/portal/auth/contact-verification/verify/route.ts","utf8");
  assert.equal((route.match(/portalOtpAttemptGuard\(challenge,/g)||[]).length,2,
    "both an incorrect guess and a successful claim must atomically recheck all limits");
  assert.match(route,/const attempted = await prisma\.portalOtpChallenge\.updateMany\(/);
  assert.match(route,/where: portalOtpAttemptGuard\(challenge, new Date\(\)\)/);
  assert.match(route,/attempted\.count !== 1/);
  assert.match(route,/const consumed = await tx\.portalOtpChallenge\.updateMany\(/);
  assert.match(route,/where: portalOtpAttemptGuard\(challenge, verifiedAt\)/);
  assert.match(route,/consumed\.count !== 1/);
  assert.ok(route.indexOf("const verifiedAt = new Date()") >
    route.indexOf("const ok = await compare(code, challenge.codeHash)"),
    "expiry must be evaluated after expensive OTP code comparison");
  assert.doesNotMatch(route,/prisma\.portalOtpChallenge\.update\(\{/,
    "unconditional attempt increments bypass challenge maxAttempts");
  assert.match(route,/tx\.portalContactVerification\.create\(/);
  assert.match(route,/tx\.auditEvent\.create\(/);
});

test("F7 OTP: real MariaDB concurrency regression is explicitly part of CI",()=>{
  const ci=readFileSync(".github/workflows/ci.yml","utf8");
  assert.match(ci,/Verify concurrent OTP claims and retry limits in MariaDB/);
  assert.match(ci,/tests\/f7-portal-otp-atomic-mariadb\.integration\.test\.ts/);
});
