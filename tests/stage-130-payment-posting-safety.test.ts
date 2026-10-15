import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { paymentPostingFingerprint, paymentPostingKey, lookupPaymentPosting } from "../src/lib/payment-posting-idempotency.ts";

const fixture=(overrides:Record<string,unknown>={})=>({
  kind:"CLIENT_ACCOUNT" as const,organizationId:randomUUID(),actorUserId:randomUUID(),
  branchId:randomUUID(),clientId:randomUUID(),currency:"AED",
  paymentMethodId:randomUUID(),legacyMethod:"",reference:"bank-ref",amount:"125.1000",
  allocations:[{invoiceId:"a",amount:"75.0000"},{invoiceId:"b",amount:"50.1000"}],...overrides,
});

test("Stage 130: payment fingerprints preserve request identity, order-independent allocations and exact currency",()=>{
  const a=fixture();
  const fingerprint=paymentPostingFingerprint(a);
  assert.equal(fingerprint,paymentPostingFingerprint({...a,amount:"125.1",allocations:[...a.allocations].reverse()}));
  for(const change of [{currency:"USD"},{organizationId:randomUUID()},{actorUserId:randomUUID()},
    {branchId:randomUUID()},{reference:"different"},{paymentMethodId:randomUUID()},
    {allocations:[{invoiceId:"a",amount:"125.1000"}]}]){
    assert.notEqual(fingerprint,paymentPostingFingerprint({...a,...change}));
  }
  assert.equal(paymentPostingKey("bad"),null);
  assert.equal(paymentPostingKey(randomUUID().toUpperCase())?.length,36);
});

test("Stage 130: existing posting can only replay an exact completed financial snapshot",async()=>{
  const key=randomUUID(),org=randomUUID(),fingerprint="a".repeat(64);
  const fake={payment:{findFirst:async()=>({postingFingerprint:fingerprint,postingResponseSnapshot:{
    status:"ok",paymentId:"immutable-id",balanceAmount:"7.0000",
  }})}} as unknown as Parameters<typeof lookupPaymentPosting>[0];
  const valid=await lookupPaymentPosting(fake,org,key,fingerprint);
  assert.equal(valid?.kind,"replay");
  if (valid?.kind === "replay") assert.equal(valid.response.paymentId,"immutable-id");
  assert.equal((await lookupPaymentPosting(fake,org,key,"b".repeat(64)))?.kind,"conflict");
});

test("Stage 130: both posting routes and bilingual forms enforce durable retry key before mutation",()=>{
  const payment=readFileSync("src/app/api/billing/payments/route.ts","utf8");
  const client=readFileSync("src/app/api/billing/client-payments/route.ts","utf8");
  const form=readFileSync("src/components/payment-form.tsx","utf8");
  const clientForm=readFileSync("src/components/client-account-manager.tsx","utf8");
  for(const route of [payment,client]){
    assert.match(route,/paymentPostingKey\(body\.postingKey\)/);
    assert.match(route,/lookupPaymentPosting\(prisma/);
    assert.match(route,/postingResponseSnapshot: responseSnapshot/);
    assert.match(route,/posting_key_reused/);
  }
  for(const ui of [form,clientForm]){
    assert.match(ui,/postingAttempt = useRef/);
    assert.match(ui,/crypto\.randomUUID\(\)/);
    assert.match(ui,/postingKey: postingAttempt\.current\.key/);
  }
});
