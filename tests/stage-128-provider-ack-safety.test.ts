import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseProviderReceipt, providerReceiptSecret, verifyProviderReceiptSignature, providerReceiptFingerprint } from "../src/lib/provider-receipt-security.ts";
import { parseOutboundAck, outboundAckFingerprint } from "../src/lib/hl7-outbound-ack.ts";

const tenant = "00000000-0000-4000-8000-000000000001";
const delivery = "00000000-0000-4000-8000-000000000002";
const master = "safe-synthetic-master-secret-for-provider-receipt-tests";
const input = { organizationId: tenant, deliveryId: delivery, channel: "EMAIL",
  providerMessageId: "GATEWAY-M1", receiptId: "RECEIPT-1", status: "DELIVERED" } as const;
test("Stage 128: provider callback signatures are bound to tenant, channel, timestamp and raw evidence", () => {
  const raw = JSON.stringify(input), parsed = parseProviderReceipt(raw);
  const stamp = "1792068000", now=1792068000000;
  const signature = "sha256=" + createHmac("sha256",providerReceiptSecret(master,parsed))
    .update(stamp + "." + raw).digest("hex");
  verifyProviderReceiptSignature(raw,parsed,stamp,signature,master,now);
  assert.throws(() => verifyProviderReceiptSignature(raw,parsed,stamp,signature,master,now+900000),/receipt_not_authorized/);
  assert.throws(() => verifyProviderReceiptSignature(raw,{...parsed,organizationId:delivery},
    stamp,signature,master,now),/receipt_not_authorized/);
  assert.throws(() => verifyProviderReceiptSignature(raw,{...parsed,channel:"SMS"},
    stamp,signature,master,now),/receipt_not_authorized/);
  assert.throws(() => verifyProviderReceiptSignature(raw,parsed,stamp,signature,undefined,now),/not_configured/);
  assert.notEqual(providerReceiptFingerprint(input),providerReceiptFingerprint({...input,status:"FAILED"}));
  assert.notEqual(providerReceiptFingerprint(input),providerReceiptFingerprint({...input,receiptId:"RECEIPT-2"}));
  for(const malformed of [{...input,deliveryId:"invalid"},{...input,status:"SENT"},
    {...input,providerMessageId:""},{...input,unexpected:true}]){
    assert.throws(()=>parseProviderReceipt(JSON.stringify(malformed)),/invalid_receipt/);
  }
});
test("Stage 128: simulated HL7 AA/AE/AR must match the original control ID and declared code", () => {
  const wire=(code:string,id="CTRL-1")=>
    "MSH|^~\\&|DEVICE|LAB|LIS|LAB|20261015||ACK|X|P|2.5\rMSA|"+code+"|"+id+"\r";
  for(const code of ["AA","AE","AR"] as const){
    const ack=parseOutboundAck({code,attempt:1,payload:wire(code)},"CTRL-1");
    assert.equal(ack.code,code);
    assert.notEqual(outboundAckFingerprint(ack),outboundAckFingerprint({...ack,attempt:2}));
  }
  assert.throws(()=>parseOutboundAck({code:"AA",attempt:1,payload:wire("AR")},"CTRL-1"),/mismatch/);
  assert.throws(()=>parseOutboundAck({code:"AA",attempt:1,payload:wire("AA","WRONG")},"CTRL-1"),/mismatch/);
  assert.throws(()=>parseOutboundAck({code:"AA",attempt:1,payload:wire("AA")+"MSA|AA|CTRL-1\r"},"CTRL-1"),/msa_invalid/);
  assert.throws(()=>parseOutboundAck({code:"AA",attempt:0},"CTRL-1"),/attempt_invalid/);
});
test("Stage 128: callbacks and transport ACK updates retain report and tenant fences",()=>{
  const receipt=readFileSync("src/app/api/notifications/provider-receipt/route.ts","utf8");
  const ack=readFileSync("src/app/api/integrations/messages/[id]/ack/route.ts","utf8");
  const dispatch=readFileSync("src/lib/notifications.ts","utf8");
  assert.match(receipt,/verifyProviderReceiptSignature/);
  assert.match(receipt,/notification: \{ organizationId: receipt.organizationId \}/);
  assert.match(receipt,/providerMessageId: receipt.providerMessageId/);
  assert.match(receipt,/receiptFingerprint: null/);
  assert.match(receipt,/version.version !== version.report.currentVersion/);
  assert.match(receipt,/NOTIFICATION_PROVIDER_RECEIPT/);
  assert.match(ack,/message.ackFingerprint === fingerprint/);
  assert.match(ack,/ackFingerprint: fingerprint/);
  assert.match(dispatch,/Idempotency-Key": idempotencyKey/);
  assert.match(dispatch,/NotificationDeliveryStatus.DELIVERED/);
});
