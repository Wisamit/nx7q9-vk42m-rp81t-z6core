import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  newStepUpToken,stepUpHash,validStepUpAction,validStepUpResource,
  STEP_UP_FAILURE_LIMIT,STEP_UP_TTL_MS,STEP_UP_WINDOW_MS,
} from "../src/lib/staff-step-up.ts";
const uid=randomUUID(),branch=randomUUID(),payment=randomUUID(),method=randomUUID();
test("Stage 96: one-use opaque tokens and exact action resource constraints",()=>{
 const token=newStepUpToken();
 assert.match(token,/^[-A-Za-z0-9_]{40,80}$/);
 assert.match(stepUpHash(token),/^[a-f0-9]{64}$/);
 assert.notEqual(stepUpHash(token),stepUpHash(newStepUpToken()));
 assert.equal(STEP_UP_TTL_MS,120000);
 assert.equal(STEP_UP_FAILURE_LIMIT,5);
 assert.equal(STEP_UP_WINDOW_MS,900000);
 for(const action of ["MEDICAL_APPROVAL","RESULT_RELEASE","DISCOUNT_APPROVAL","REFUND_POST"])
   assert.equal(validStepUpAction(action),true);
 for(const action of ["REFUND","BYPASS","ADMIN","__proto__"])
   assert.equal(validStepUpAction(action),false);
 assert.equal(validStepUpResource("RESULT_RELEASE",uid),true);
 assert.equal(validStepUpResource("MEDICAL_APPROVAL",uid),true);
 assert.equal(validStepUpResource("DISCOUNT_APPROVAL",uid),true);
 assert.equal(validStepUpResource("REFUND_POST",`${payment}:${uid}:45.2500:${method}`),true);
 assert.equal(validStepUpResource("REFUND_POST",`${payment}:${uid}:45.25001:${method}`),false);
 assert.equal(validStepUpResource("REFUND_POST",`${payment}:${uid}:45:${method}`),true);
 assert.equal(validStepUpResource("REFUND_POST",`${payment}:${uid}:-45:${method}`),false);
 assert.equal(validStepUpResource("RESULT_RELEASE",`${payment}:${uid}`),false);
 assert.equal(validStepUpResource("REFUND_POST",uid),false);
 assert.equal(validStepUpResource("REFUND_POST",`${payment}:${uid}:100:${method}`),true);
});
test("Stage 96: server-side grant issuance and consumption are independent and fail closed",()=>{
 const schema=readFileSync("prisma/schema.prisma","utf8");
 const migration=readFileSync("prisma/migrations/20261012200000_staff_high_risk_step_up/migration.sql","utf8");
 const issuer=readFileSync("src/app/api/security/step-up/route.ts","utf8");
 const consumer=readFileSync("src/lib/staff-step-up.ts","utf8");
 const clinical=readFileSync("src/app/api/results/[id]/medical-validate/route.ts","utf8");
 const release=readFileSync("src/app/api/results/[id]/release/route.ts","utf8");
 const discount=readFileSync("src/app/api/billing/discount-approvals/[id]/route.ts","utf8");
 const refund=readFileSync("src/app/api/billing/refunds/route.ts","utf8");
 const clinicalUi=readFileSync("src/components/result-workflow-actions.tsx","utf8");
 const refundUi=readFileSync("src/components/billing-adjustment-modals.tsx","utf8");
 const discountUi=readFileSync("src/components/discount-approval-manager.tsx","utf8");
 assert.match(schema,/model StaffStepUpGrant \{/);
 assert.match(schema,/model StaffStepUpAttempt \{/);
 assert.match(migration,/UNIQUE INDEX `staff_step_up_grants_token_hash_key`/);
 assert.match(issuer,/permissionSet\(session\)/);
 assert.match(issuer,/compare\(input.password/);
 assert.match(issuer,/verifyTotp\(/);
 assert.match(issuer,/currentUser.mfaEnabled/);
 assert.match(issuer,/FOR UPDATE/);
 assert.match(issuer,/staffStepUpAttempt.count/);
 assert.match(issuer,/STAFF_STEP_UP_DENIED/);
 assert.match(issuer,/STAFF_STEP_UP_GRANTED/);
 assert.match(consumer,/record.sessionId!==args.sessionId/);
 assert.match(consumer,/record.organizationId!==args.organizationId/);
 assert.match(consumer,/record.branchId!==args.branchId/);
 assert.match(consumer,/record.action!==args.action/);
 assert.match(consumer,/record.resourceKey!==args.resourceKey/);
 assert.match(consumer,/consumedAt:null,expiresAt:\{gt:new Date\(\)\}/);
 assert.match(consumer,/claim.count!==1/);
 assert.match(consumer,/STAFF_STEP_UP_CONSUMED/);
 for(const route of [clinical,release,discount,refund])
   assert.match(route,/consumeStaffStepUp\(tx,/);
 assert.match(clinical,/action:"MEDICAL_APPROVAL"/);
 assert.match(release,/action:"RESULT_RELEASE"/);
 assert.match(discount,/action:"DISCOUNT_APPROVAL"/);
 assert.match(refund,/action:"REFUND_POST"/);
 assert.match(clinicalUi,/StaffStepUpDialog/);
 assert.match(refundUi,/StaffStepUpDialog/);
 assert.match(discountUi,/StaffStepUpDialog/);
 assert.doesNotMatch(consumer,/passwordHash|mfaSecretEncrypted/);
 assert.doesNotMatch(issuer,/newValues:\{[^}]*password|newValues:\{[^}]*totp/);
});
