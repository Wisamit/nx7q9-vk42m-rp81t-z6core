import net from "node:net";
import { mkdir, open, rename, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { parseHl7Oru } from "./protocols.mjs";
import { validateBridgeSettings } from "./file-worker.mjs";

const START=0x0b, END=0x1c, CR=0x0d, MAX_BYTES=1000000;
function hl7Time(date=new Date()) {
  return date.toISOString().replace(/[-:T.Z]/g,"").slice(0,14);
}
function frame(raw) {return Buffer.concat([Buffer.from([START]),Buffer.from(raw,"utf8"),Buffer.from([END,CR])]);}
function ack(controlId,accepted,reason=null) {
  const msh="MSH|^~\\&|FAMILY_LAB_BRIDGE|LOCAL|ANALYZER|LOCAL|"+hl7Time()+"||ACK|"+randomUUID()+"|P|2.5";
  const msa="MSA|"+(accepted?"AA":"AR")+"|"+(controlId||"")+(reason?"|"+reason:"");
  return frame(msh+"\r"+msa+"\r");
}
async function storeDurably(inputDir,raw) {
  const id=randomUUID(),temp=join(inputDir,id+".partial"),ready=join(inputDir,id+".ready");
  const fd=await open(temp,"wx",0o600);
  try {await fd.writeFile(raw,"utf8");await fd.sync();} finally {await fd.close();}
  await rename(temp,ready);
  // Directory fsync is available on Unix and ensures rename durability.
  // Windows may reject syncing a directory; the file itself is synced.
  try {const dir=await open(inputDir,"r");try {await dir.sync();} finally {await dir.close();}}catch(error){
    if(process.platform!=="win32") throw error;
  }
  return ready;
}

/** ACK means persisted to the local bridge spool, never result verified/released. */
export async function acceptMllpPayload(inputDir,raw,profile) {
  const parsed=parseHl7Oru(raw,profile);
  await storeDurably(inputDir,raw);
  return parsed.bridgeMessageId;
}

export function validateMllpSettings(config) {
  const settings=validateBridgeSettings(config);
  if(settings.protocol!=="HL7_V2") throw Error("MLLP_REQUIRES_HL7_V2");
  const host=config.listenHost || "127.0.0.1";
  const allowed=["127.0.0.1","::1","localhost"];
  if(!allowed.includes(host) && config.allowRemote !== true) throw Error("MLLP_REMOTE_BIND_REQUIRES_APPROVAL");
  if(!allowed.includes(host) && (!Array.isArray(config.allowedAddresses)||config.allowedAddresses.length===0)) {
    throw Error("MLLP_REMOTE_REQUIRES_IP_ALLOWLIST");
  }
  const port=Number(config.listenPort);
  if(!Number.isInteger(port)||port<1||port>65535) throw Error("MLLP_PORT_INVALID");
  return {...settings,host,port,allowedAddresses:config.allowedAddresses||[]};
}

export function createMllpServer(settings) {
  const server=net.createServer(socket=>{
    let buffer=Buffer.alloc(0),processing=false;
    const ip=(socket.remoteAddress||"").replace(/^::ffff:/,"");
    const remoteAllowed=["127.0.0.1","::1"].includes(ip)||settings.allowedAddresses.includes(ip);
    if(!remoteAllowed) {socket.destroy();return;}
    socket.setTimeout(30000,()=>socket.destroy());
    const drain=async()=>{
      if(processing)return;
      processing=true;
      try {
        while(buffer.length){
          if(buffer[0]!==START){socket.destroy();return;}
          const end=buffer.indexOf(Buffer.from([END,CR]),1);
          if(end<0){
            if(buffer.length>MAX_BYTES+3) socket.destroy();
            return;
          }
          if(end-1>MAX_BYTES){socket.destroy();return;}
          const bytes=buffer.subarray(1,end);
          buffer=buffer.subarray(end+2);
          let controlId="";
          try{
            const raw=new TextDecoder("utf-8",{fatal:true}).decode(bytes);
            controlId=raw.split("\r")[0]?.split("|")[9]||"";
            const id=await acceptMllpPayload(settings.inputDir,raw,settings.profile);
            socket.write(ack(id,true));
          }catch(error){
            const reason=error?.code||"MALFORMED_FRAME";
            // An invalid frame is NAKed, never staged or silently discarded.
            if(!socket.destroyed)socket.write(ack(/^[A-Za-z0-9._/-]{1,150}$/.test(controlId)?controlId:"",false,reason));
          }
        }
      } finally {processing=false;}
    };
    socket.on("data",chunk=>{
      buffer=Buffer.concat([buffer,chunk]);
      if(buffer.length>MAX_BYTES+3){socket.destroy();return;}
      void drain().catch(()=>socket.destroy());
    });
  });
  return server;
}

export async function startMllpListener(settings) {
  await mkdir(settings.inputDir,{recursive:true});
  const server=createMllpServer(settings);
  await new Promise((ok,fail)=>{server.once("error",fail);server.listen(settings.port,settings.host,()=>{server.off("error",fail);ok();});});
  return server;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const configFile=process.argv[2];
  if(!configFile)throw Error("Usage: node bridge/mllp-listener.mjs /path/to/bridge-config.json");
  const settings=validateMllpSettings(JSON.parse(await readFile(configFile,"utf8")));
  const server=await startMllpListener(settings);
  console.log(JSON.stringify({status:"LISTENING",host:settings.host,port:settings.port,protocol:"HL7_V2"}));
  for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>server.close());
}
