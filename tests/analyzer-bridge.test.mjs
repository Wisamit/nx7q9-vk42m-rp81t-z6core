import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { parseHl7Oru, parseAstmRecords, normalizeAnalyzerMessage } from "../bridge/protocols.mjs";
import { validateBridgeSettings, pollReadyFiles } from "../bridge/file-worker.mjs";

const hl7="MSH|^~\\&|A|LAB|LIS|LAB|202610081200||ORU^R01|MSG-001|P|2.5\r"
  +"PID|1\rOBR|1||BC001|CULTURE^Test\rOBX|1|NM|GLU^Glucose||5.2|mmol/L\rOBX|2|ST|COLOR^Colour||yellow|\r";

test("HL7 ORU normalization uses explicit barcode profile and stable observation IDs",()=>{
  const parsed=parseHl7Oru(hl7,{barcodeSource:"OBR_3"});
  assert.equal(parsed.bridgeMessageId,"MSG-001");
  assert.deepEqual(parsed.observations,[
    {observationId:"MSG-001:1:1",barcode:"BC001",analyzerTestCode:"GLU",rawValue:"5.2",rawUnit:"mmol/L"},
    {observationId:"MSG-001:1:2",barcode:"BC001",analyzerTestCode:"COLOR",rawValue:"yellow",rawUnit:null},
  ]);
  const spm=hl7.replace("OBR|1||BC001|CULTURE^Test\r","OBR|1|||CULTURE^Test\rSPM|1|SAMPLE-22\r");
  assert.equal(parseHl7Oru(spm,{barcodeSource:"SPM_2"}).observations[0].barcode,"SAMPLE-22");
});

test("bridge rejects unapproved and ambiguous protocol fields rather than guessing clinically",()=>{
  const cases=[
    ()=>parseHl7Oru(hl7,{}),
    ()=>parseHl7Oru(hl7.replace("ORU^R01","ORM^O01"),{barcodeSource:"OBR_3"}),
    ()=>parseHl7Oru(hl7.replace("OBX|1|NM","OBX|1|CWE"),{barcodeSource:"OBR_3"}),
    ()=>parseHl7Oru(hl7.replace("BC001","BC001\\F\\BAD"),{barcodeSource:"OBR_3"}),
    ()=>parseHl7Oru(hl7.replace("OBX|2|ST","OBX|1|ST"),{barcodeSource:"OBR_3"}),
    ()=>parseHl7Oru(hl7.replace("5.2|mmol/L","5.2~6.1|mmol/L"),{barcodeSource:"OBR_3"}),
    ()=>normalizeAnalyzerMessage(hl7,"FILE",{}),
  ];
  for (const fail of cases) assert.throws(fail,/INVALID|REQUIRED|UNSUPPORTED|COMPLEX|DUPLICATE|PROFILE|REQUIRES_APPROVED_ADAPTER/);
});

test("ASTM record parser requires approved field profile and verified transport framing",()=>{
  const raw="H|\\^&|||ANALYZER\rP|1\rO|1|BAR-9\rR|1|^^^GLU|6.8|mmol/L\rL|1\r";
  const profile={approved:true,sampleIdField:2,testCodeField:2,valueField:3,unitField:4};
  assert.throws(()=>parseAstmRecords(raw,{}),/APPROVED_PROFILE/);
  const parsed=parseAstmRecords(raw,profile);
  assert.equal(parsed.observations.length,1);
  assert.equal(parsed.observations[0].analyzerTestCode,"GLU");
  assert.equal(parsed.observations[0].barcode,"BAR-9");
  assert.equal(parsed.observations[0].rawValue,"6.8");
  assert.ok(parsed.bridgeMessageId.startsWith("astm-"));
  assert.throws(()=>parseAstmRecords("\x02"+raw+"\x03",profile),/ASTM_HEADER_REQUIRED|TRANSPORT_FRAME/);
});

test("file bridge preserves exact raw bytes and leaves files pending on transient HTTP errors",async()=>{
  const root=await mkdtemp(join(tmpdir(),"analyzer-bridge-"));
  const inputDir=join(root,"input"),archivedDir=join(root,"archive"),rejectedDir=join(root,"reject");
  try {
    const {mkdir}=await import("node:fs/promises");await mkdir(inputDir);
    const settings=validateBridgeSettings({analyzerId:randomUUID(),lisOrigin:"https://lis.example.org/",protocol:"HL7_V2",
      profile:{barcodeSource:"OBR_3"},inputDir,archivedDir,rejectedDir});
    const raw=hl7.replace("yellow|\r","yellow   |\r");
    await writeFile(join(inputDir,"message.ready"),raw,"utf8");
    let first=true;const seen=[];
    const sender=async(url,options)=>{
      seen.push({url,options});
      if(first){first=false;throw Error("network disconnected");}
      return {ok:true,status:202,json:async()=>({status:"ok"})};
    };
    const pending=await pollReadyFiles(settings,"x".repeat(40),sender);
    assert.equal(pending[0].status,"RETRY_PENDING");
    assert.equal((await readdir(inputDir)).length,1);
    const delivered=await pollReadyFiles(settings,"x".repeat(40),sender);
    assert.equal(delivered[0].status,"SENT_TO_LIS_STAGING");
    assert.equal((await readdir(inputDir)).length,0);
    assert.equal((await readdir(archivedDir)).length,1);
    const rawRequest=seen.find(x=>x.url.endsWith("/messages")&&x.options);
    assert.ok(rawRequest);
    assert.equal(JSON.parse(rawRequest.options.body).rawPayload,raw);
    assert.equal(rawRequest.options.headers.authorization,"Bearer "+"x".repeat(40));
    assert.equal((await readFile(join(archivedDir,(await readdir(archivedDir))[0]),"utf8")),raw);
  } finally {await rm(root,{recursive:true,force:true});}
});

test("malformed frame is quarantined with metadata but not clinical content",async()=>{
  const root=await mkdtemp(join(tmpdir(),"analyzer-bridge-bad-"));
  try {
    const {mkdir}=await import("node:fs/promises");await mkdir(join(root,"in"));
    const settings=validateBridgeSettings({analyzerId:randomUUID(),lisOrigin:"https://lis.example.org",protocol:"HL7_V2",
      profile:{barcodeSource:"OBR_3"},inputDir:join(root,"in"),archivedDir:join(root,"archive"),rejectedDir:join(root,"reject")});
    await writeFile(join(settings.inputDir,"bad.ready"),"TEST PATIENT clinical content","utf8");
    const outcome=await pollReadyFiles(settings,"x".repeat(40),async()=>{throw Error("should never send");});
    assert.equal(outcome[0].status,"REJECTED");
    assert.equal((await readdir(settings.inputDir)).length,0);
    const filenames=await readdir(settings.rejectedDir);
    const manifest=filenames.find(x=>x.endsWith(".error.json"));
    assert.ok(manifest);
    const errors=await readFile(join(settings.rejectedDir,manifest),"utf8");
    assert.ok(!errors.includes("TEST PATIENT"));
  } finally {await rm(root,{recursive:true,force:true});}
});

test("MLLP listener ACKs only after durable local spool, including split TCP frames", {timeout:15000}, async()=>{
  const { createMllpServer }=await import("../bridge/mllp-listener.mjs");
  const net=await import("node:net");
  const root=await mkdtemp(join(tmpdir(),"analyzer-mllp-"));
  let server,socket;
  try{
    server=createMllpServer({inputDir:root,profile:{barcodeSource:"OBR_3"},allowedAddresses:[]});
    await new Promise((ok,fail)=>{server.once("error",fail);server.listen(0,"127.0.0.1",ok);});
    socket=net.connect(server.address().port,"127.0.0.1");
    await new Promise((ok,fail)=>{socket.once("connect",ok);socket.once("error",fail);});
    const received=new Promise((ok,fail)=>{
      socket.once("data",ok);socket.once("error",fail);
    });
    socket.write(Buffer.from([0x0b]));
    socket.write(Buffer.from(hl7,"utf8"));
    socket.write(Buffer.from([0x1c,0x0d]));
    const reply=(await received).toString("utf8");
    assert.ok(reply.startsWith("\x0bMSH|"));
    assert.ok(reply.includes("MSA|AA|MSG-001"));
    const ready=(await readdir(root)).filter(x=>x.endsWith(".ready"));
    assert.equal(ready.length,1);
    assert.equal(await readFile(join(root,ready[0]),"utf8"),hl7);
  }finally{
    socket?.destroy();
    if(server)await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});

test("MLLP listener NAKs malformed frames without writing clinical data", {timeout:15000},async()=>{
  const {createMllpServer}=await import("../bridge/mllp-listener.mjs");
  const net=await import("node:net");
  const root=await mkdtemp(join(tmpdir(),"analyzer-mllp-invalid-"));
  let server,socket;
  try{
    server=createMllpServer({inputDir:root,profile:{barcodeSource:"OBR_3"},allowedAddresses:[]});
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    socket=net.connect(server.address().port,"127.0.0.1");
    await new Promise(resolve=>socket.once("connect",resolve));
    const response=new Promise(resolve=>socket.once("data",resolve));
    socket.write(Buffer.concat([Buffer.from([0x0b]),Buffer.from("MALFORMED"),Buffer.from([0x1c,0x0d])]));
    assert.ok((await response).toString("utf8").includes("MSA|AR|"));
    assert.equal((await readdir(root)).filter(x=>x.endsWith(".ready")).length,0);
  }finally{
    socket?.destroy();
    if(server)await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true,force:true});
  }
});

test("ASTM E1381 frame checksums and frame sequencing are checked before normalization", async()=>{
  const {parseE1381Frame,decodeE1381Message}=await import("../bridge/astm-e1381.mjs");
  const encode=(seq,data,isFinal)=>{
    const end=isFinal?0x03:0x17;
    const head=Buffer.from(String(seq)+data,"utf8");
    let sum=end;
    for(const byte of head)sum=(sum+byte)&0xff;
    return Buffer.concat([
      Buffer.from([0x02]),head,Buffer.from([end]),
      Buffer.from(sum.toString(16).toUpperCase().padStart(2,"0"),"ascii"),
      Buffer.from([0x0d,0x0a]),
    ]);
  };
  const raw="H|\\^&|||ANALYZER\rP|1\rO|1|BAR-9\rR|1|^^^GLU|6.8|mmol/L\rL|1\r";
  const frames=[encode(1,raw.slice(0,22),false),encode(2,raw.slice(22),true)];
  assert.equal(parseE1381Frame(frames[0]).frameNumber,1);
  assert.equal(decodeE1381Message(frames),raw);
  const badChecksum=Buffer.from(frames[0]);badChecksum[badChecksum.length-3]=badChecksum[badChecksum.length-3]===0x30?0x31:0x30;
  assert.throws(()=>parseE1381Frame(badChecksum),/ASTM_FRAME_CHECKSUM_INVALID/);
  assert.throws(()=>decodeE1381Message([frames[1],frames[0]]),/ASTM_FRAME_SEQUENCE_INVALID/);
  assert.throws(()=>decodeE1381Message([encode(1,"H|test\r",true),encode(2,"L|1\r",true)]),/ASTM_FRAME_FINALITY_INVALID/);
  assert.throws(()=>decodeE1381Message(frames,{maxBytes:10}),/ASTM_FRAME_PAYLOAD_TOO_LARGE/);
});

test("invalid UTF-8 is quarantined without lossy analyzer message transcription",async()=>{
  const root=await mkdtemp(join(tmpdir(),"analyzer-bridge-utf8-"));
  const {mkdir}=await import("node:fs/promises");
  try {
    await mkdir(join(root,"input"));
    const settings=validateBridgeSettings({analyzerId:randomUUID(),lisOrigin:"https://lis.example.org",
      protocol:"HL7_V2",profile:{barcodeSource:"OBR_3"},inputDir:join(root,"input"),
      archivedDir:join(root,"archived"),rejectedDir:join(root,"rejected")});
    await writeFile(join(settings.inputDir,"invalid.ready"),Buffer.from([0xed,0xa0,0x80]));
    const outcome=await pollReadyFiles(settings,"a".repeat(40),async()=>{throw Error("must not send");});
    assert.equal(outcome[0].status,"REJECTED");
    assert.equal(outcome[0].reason,"BRIDGE_INVALID_UTF8_REQUIRES_VENDOR_ADAPTER");
    assert.equal((await readdir(settings.archivedDir)).length,0);
    assert.equal((await readdir(settings.rejectedDir)).filter(x=>x.endsWith(".rejected")).length,1);
  }finally{await rm(root,{recursive:true,force:true});}
});
