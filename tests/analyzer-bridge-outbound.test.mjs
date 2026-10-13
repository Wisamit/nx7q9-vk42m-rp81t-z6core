import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { validateOutboundSettings, pollOutbound } from "../bridge/outbound-worker.mjs";

function response(data,status=200) {
  return {status,ok:status>=200&&status<300,json:async()=>data};
}
async function sandbox(t) {
  const root=await mkdtemp(join(tmpdir(),"fl-bridge-out-"));
  t.after(async()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,"in"));
  const analyzerId=randomUUID(),deviceKey="LAB-DEVICE-1";
  const config={
    analyzerId,lisOrigin:"https://lis.example.org",protocol:"HL7_V2",profile:{barcodeSource:"OBR_3"},
    inputDir:join(root,"in"),archivedDir:join(root,"archive"),rejectedDir:join(root,"reject"),
    outbound:{
      enabled:true,vendorApproved:true,mode:"FILE_HANDOFF",deviceKey,
      pendingDir:join(root,"pending"),receiptDir:join(root,"receipts"),
      completedDir:join(root,"completed"),quarantineDir:join(root,"quarantine"),
    },
  };
  const settings=validateOutboundSettings(config);
  const command={
    workOrderId:randomUUID(),leaseToken:"a".repeat(64),attempt:1,
    leaseExpiresAt:new Date(Date.now()+110000).toISOString(),
    bridgeDeviceKey:deviceKey,accessionNumber:"FAKE-ORDER-1",
    specimenBarcode:"FAKE-BAR-1",lisTestCode:"TEST-1",analyzerTestCode:"DEVICE-T1",
  };
  return {root,settings,config,command};
}
function claimResponse(workOrders) {
  return {status:"ok",deliveryGuarantee:"AT_LEAST_ONCE",bridgeMustDeduplicateBy:"workOrderId",workOrders};
}
test("outbound integration is opt-in and may not alias inbound or nested spool directories", async t => {
  const {config}=await sandbox(t);
  assert.throws(()=>validateOutboundSettings({...config,outbound:{...config.outbound,enabled:false}}),/APPROVED_FILE_HANDOFF/);
  assert.throws(()=>validateOutboundSettings({...config,outbound:{...config.outbound,vendorApproved:false}}),/APPROVED_FILE_HANDOFF/);
  assert.throws(()=>validateOutboundSettings({...config,outbound:{...config.outbound,deviceKey:""}}),/DEVICE_KEY_REQUIRED/);
  assert.throws(()=>validateOutboundSettings({...config,outbound:{...config.outbound,pendingDir:config.inputDir}}),/DIRECTORIES_OVERLAP/);
  assert.throws(()=>validateOutboundSettings({...config,outbound:{...config.outbound,pendingDir:join(config.inputDir,"child")}}),/DIRECTORIES_NESTED/);
});
test("one-at-a-time claim is durable locally, waits for real vendor receipt, then ACKs with exact wire",async t=>{
  const {settings,command}=await sandbox(t);
  const token="b".repeat(50);
  let claims=0,acks=0;
  const wire="MSH|^~\\&|ANALYZER|LOCAL|DEVICE|LAB|20261013||OML^O21|DEV-1|P|2.5\rOBR|1||FAKE-BAR-1\r";
  const sender=async(url,options)=>{
    const body=JSON.parse(options.body);
    assert.equal(options.headers.authorization,"Bearer "+token);
    if(url.endsWith("/claim")) {
      assert.deepEqual(body,{limit:1});
      claims++;
      return response(claimResponse(claims===1?[command]:[]));
    }
    assert.ok(url.endsWith("/ack"));
    acks++;
    assert.equal(body.code,"ACCEPTED");
    assert.equal(body.rawPayload,wire);
    assert.equal(body.leaseToken,command.leaseToken);
    return response({status:"ok",workOrderStatus:"ACKNOWLEDGED",workOrderId:command.workOrderId,replayed:false});
  };
  assert.equal((await pollOutbound(settings,token,sender)).status,"CLAIM_DURABLY_STAGED_NOT_SENT");
  const base=command.workOrderId+".1";
  const pending=join(settings.pendingDir,base+".claim.json");
  assert.deepEqual(JSON.parse(await readFile(pending,"utf8")),command);
  if(process.platform!=="win32") assert.equal((await stat(pending)).mode & 0o777,0o600);
  assert.equal((await pollOutbound(settings,token,sender)).status,"WAITING_FOR_VENDOR_RECEIPT");
  assert.equal(claims,1);
  assert.equal(acks,0);
  await writeFile(join(settings.receiptDir,base+".receipt.json"),
    JSON.stringify({workOrderId:command.workOrderId,attempt:1,code:"ACCEPTED",rawPayload:wire}));
  assert.equal((await pollOutbound(settings,token,sender)).status,"VENDOR_RECEIPT_ACKNOWLEDGED");
  assert.equal(acks,1);
  assert.equal((await readdir(settings.pendingDir)).length,0);
  const completed=await readdir(settings.completedDir);
  assert.equal(completed.filter(name=>name.endsWith(".done.json")).length,1);
  assert.equal(completed.filter(name=>name.endsWith(".claim.json")).length,1);
  assert.equal(completed.filter(name=>name.endsWith(".receipt.json")).length,1);
  assert.ok(!(await readFile(join(settings.completedDir,base+".done.json"),"utf8")).includes(command.leaseToken));
  assert.equal((await pollOutbound(settings,token,sender)).status,"NO_WORK_ORDERS");
});
test("ambiguous lost HTTP ACK retries do not trigger another physical handoff",async t=>{
  const {settings,command}=await sandbox(t);
  const token="b".repeat(50);
  let acks=0,claims=0;
  const sender=async(url)=>{
    if(url.endsWith("/claim")) {
      claims++;
      return response(claimResponse([command]));
    }
    acks++;
    if(acks===1) throw Error("disconnected after LIS persisted acknowledgement");
    return response({status:"ok",workOrderStatus:"ACKNOWLEDGED",workOrderId:command.workOrderId,replayed:true});
  };
  assert.equal((await pollOutbound(settings,token,sender)).status,"CLAIM_DURABLY_STAGED_NOT_SENT");
  const base=command.workOrderId+".1";
  await writeFile(join(settings.receiptDir,base+".receipt.json"),
    JSON.stringify({workOrderId:command.workOrderId,attempt:1,code:"ACCEPTED",rawPayload:"raw outbound wire"}));
  await assert.rejects(pollOutbound(settings,token,sender),/disconnected/);
  assert.equal((await readdir(settings.pendingDir)).length,1);
  assert.equal((await readdir(settings.receiptDir)).length,1);
  assert.equal((await pollOutbound(settings,token,sender)).status,"VENDOR_RECEIPT_ACKNOWLEDGED");
  assert.equal(acks,2);
  assert.equal(claims,1);
  // A replayed work order after an earlier physical command is not requeued locally.
  assert.equal((await pollOutbound(settings,token,sender)).status,"PREVIOUS_DEVICE_ATTEMPT_REQUIRES_RECONCILIATION");
  assert.equal((await readdir(settings.pendingDir)).length,0);
});
test("mismatched, fabricated and expired receipts never call the LIS ACK endpoint",async t=>{
  const {settings,command}=await sandbox(t);
  const token="b".repeat(50);
  let acks=0;
  const sender=async(url)=>{
    if(url.endsWith("/claim"))return response(claimResponse([command]));
    acks++;
    throw Error("no ACK permitted");
  };
  await pollOutbound(settings,token,sender);
  const base=command.workOrderId+".1",receipt=join(settings.receiptDir,base+".receipt.json");
  await writeFile(receipt,JSON.stringify({workOrderId:randomUUID(),attempt:1,code:"ACCEPTED",rawPayload:"wire"}));
  assert.equal((await pollOutbound(settings,token,sender)).status,"RECEIPT_INVALID_REQUIRES_RECONCILIATION");
  await writeFile(receipt,JSON.stringify({workOrderId:command.workOrderId,attempt:1,code:"ACCEPTED"}));
  assert.equal((await pollOutbound(settings,token,sender)).status,"RECEIPT_INVALID_REQUIRES_RECONCILIATION");
  await writeFile(receipt,JSON.stringify({workOrderId:command.workOrderId,attempt:1,code:"ACCEPTED",rawPayload:"wire"}));
  assert.equal((await pollOutbound(settings,token,sender,Date.now()+200000)).status,
    "LEASE_EXPIRED_RECEIPT_REQUIRES_RECONCILIATION");
  assert.equal(acks,0);
});
test("two worker instances cannot claim concurrently; an operator must clear an abandoned lock",async t=>{
  const {settings,command}=await sandbox(t);
  const token="b".repeat(50);
  let release;
  const hold=new Promise(resolve=>{release=resolve;});
  const sender=async()=>{await hold;return response(claimResponse([command]));};
  const first=pollOutbound(settings,token,sender);
  for(let n=0;n<100;n++){
    if((await readdir(settings.pendingDir).catch(()=>[])).includes(".worker.lock"))break;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  await assert.rejects(pollOutbound(settings,token,sender),/OUTBOUND_WORKER_ALREADY_ACTIVE_OR_STALE_LOCK/);
  release();
  assert.equal((await first).status,"CLAIM_DURABLY_STAGED_NOT_SENT");
  await mkdir(join(settings.pendingDir,".worker.lock"));
  await assert.rejects(pollOutbound(settings,token,sender),/OUTBOUND_WORKER_ALREADY_ACTIVE_OR_STALE_LOCK/);
});
