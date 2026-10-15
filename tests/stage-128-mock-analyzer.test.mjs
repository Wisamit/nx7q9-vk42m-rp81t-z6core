import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMllpServer } from "../bridge/mllp-listener.mjs";

test("Stage 128 vendor mock: MLLP positive ACK is durable spool only; invalid ORU gets NAK", async t => {
  const inputDir=await mkdtemp(join(tmpdir(),"lab-128-ack-"));
  t.after(()=>rm(inputDir,{recursive:true,force:true}));
  const server=createMllpServer({inputDir,profile:{barcodeSource:"OBR_3"},allowedAddresses:[]});
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const port=server.address().port;
  async function exchange(raw) {
    const socket=net.connect(port,"127.0.0.1");
    await new Promise(resolve=>socket.once("connect",resolve));
    const outcome=new Promise((resolve,reject)=>{
      socket.once("data",data=>resolve(data.toString("utf8")));
      socket.once("error",reject);
    });
    socket.write(Buffer.concat([Buffer.from([0x0b]),Buffer.from(raw),Buffer.from([0x1c,0x0d])]));
    const response=await outcome;
    socket.destroy();
    return response;
  }
  const raw="MSH|^~\\&|MOCK|LAB|LIS|LAB|20261015||ORU^R01|MOCK-128|P|2.5\r"+
    "PID|1\rOBR|1||SYNTH-BAR-128|T1^Fixture\rOBX|1|NM|T1^Fixture||5.2|mmol/L\r";
  assert.match(await exchange(raw),/MSA\|AA\|MOCK-128/);
  const files=(await readdir(inputDir)).filter(x=>x.endsWith(".ready"));
  assert.equal(files.length,1);
  assert.equal(await readFile(join(inputDir,files[0]),"utf8"),raw);
  assert.match(await exchange(raw.replace("ORU^R01","ORM^O01").replace("MOCK-128","BAD-128")),/MSA\|AR\|BAD-128/);
  assert.equal((await readdir(inputDir)).filter(x=>x.endsWith(".ready")).length,1);
});
