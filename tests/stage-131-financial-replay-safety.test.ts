import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import { lookupPaymentPosting } from "../src/lib/payment-posting-idempotency.ts";

test("Stage 131: replay reports historical reversal, never obsolete payment success",async()=>{
  const sample={id:"old",status:"POSTED",refundedAmount:{toString:()=>"0.0000"},
    postingFingerprint:"a".repeat(64),
    postingResponseSnapshot:{status:"ok",paymentId:"old",invoiceStatus:"PAID"}};
  const db={payment:{findFirst:async()=>sample}} as unknown as Parameters<typeof lookupPaymentPosting>[0];
  assert.equal((await lookupPaymentPosting(db,"tenant","key","a".repeat(64)))?.kind,"replay");
  sample.refundedAmount={toString:()=>"0.1000"};
  assert.equal((await lookupPaymentPosting(db,"tenant","key","a".repeat(64)))?.kind,"changed");
  sample.status="REFUNDED";
  sample.refundedAmount={toString:()=>"0"};
  assert.equal((await lookupPaymentPosting(db,"tenant","key","a".repeat(64)))?.kind,"changed");
  sample.status="POSTED";
  sample.postingResponseSnapshot={status:"ok",paymentId:"another",invoiceStatus:"PAID"};
  assert.equal((await lookupPaymentPosting(db,"tenant","key","a".repeat(64)))?.kind,"conflict");
});
test("Stage 131: route enforces tenant/branch before replay disclosure and bilingual reversal",()=>{
  const invoice=readFileSync("src/app/api/billing/payments/route.ts","utf8");
  const corporate=readFileSync("src/app/api/billing/client-payments/route.ts","utf8");
  const form=readFileSync("src/components/payment-form.tsx","utf8");
  const corporateUi=readFileSync("src/components/client-account-manager.tsx","utf8");
  assert.ok(invoice.indexOf("canAccessBranch(session, replayInvoice.branchId)") <
    invoice.indexOf("const previous = await replay();"));
  assert.ok(corporate.indexOf("canAccessBranch(session, branchId)") <
    corporate.indexOf("const previous = await replay();"));
  for(const text of [invoice,corporate]) assert.match(text,/payment_posting_state_changed/);
  for(const text of [form,corporateUi]) {
    assert.match(text,/payment_posting_state_changed/);
    assert.match(text,/استرداد|استُردّت/);
  }
});
