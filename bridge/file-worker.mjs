import { readFile, readdir, rename, mkdir, writeFile } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { normalizeAnalyzerMessage, UnsupportedAnalyzerFrame } from "./protocols.mjs";

function configuredUrl(value) {
  const parsed=new URL(value || "");
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname!=="/") {
    throw Error("BRIDGE_INVALID_LIS_ORIGIN");
  }
  if (parsed.protocol!=="https:" && !(parsed.protocol==="http:" && ["127.0.0.1","localhost","[::1]"].includes(parsed.hostname))) {
    throw Error("BRIDGE_HTTPS_REQUIRED");
  }
  return parsed.origin;
}

export function validateBridgeSettings(raw) {
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) throw Error("BRIDGE_SETTINGS_INVALID");
  const analyzerId=raw.analyzerId;
  if (typeof analyzerId!=="string" || !/^[0-9a-f-]{36}$/i.test(analyzerId)) throw Error("BRIDGE_ANALYZER_ID_INVALID");
  const origin=configuredUrl(raw.lisOrigin);
  if (!["HL7_V2","ASTM"].includes(raw.protocol)) throw Error("BRIDGE_PROTOCOL_INVALID");
  if (!raw.profile || typeof raw.profile!=="object" || Array.isArray(raw.profile)) throw Error("BRIDGE_PROFILE_REQUIRED");
  const inputDir=raw.inputDir && resolve(raw.inputDir);
  const archivedDir=raw.archivedDir && resolve(raw.archivedDir);
  const rejectedDir=raw.rejectedDir && resolve(raw.rejectedDir);
  if (!inputDir || !archivedDir || !rejectedDir || new Set([inputDir,archivedDir,rejectedDir]).size!==3) {
    throw Error("BRIDGE_SPOOL_PATHS_INVALID");
  }
  return { analyzerId, origin, protocol:raw.protocol, profile:raw.profile, inputDir, archivedDir, rejectedDir };
}

async function lisPost(url, body, headers, sender=fetch) {
  const response=await sender(url,{
    method:"POST",
    headers:{"content-type":"application/json",...headers},
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(15000),
  });
  const payload=await response.json().catch(()=>({}));
  if (response.status===401 || response.status===403) throw Error("BRIDGE_CREDENTIAL_REJECTED");
  if (response.status===429 || response.status>=500) throw Error("BRIDGE_TRANSIENT_REMOTE_ERROR");
  if(!response.ok) {
    const err=new Error("BRIDGE_REJECTED_BY_LIS");
    err.permanent=true;
    err.remoteCode=typeof payload.error==="string" ? payload.error : "UNKNOWN";
    throw err;
  }
  return payload;
}

/**
 * Files are ready for delivery only after an external instrument adapter
 * atomically renames them to *.ready. Failure never removes the spool file.
 * Responses are idempotent by stable message ID and observation IDs.
 */
export async function processReadyFile(settings, path, token, sender=fetch) {
  const stat=await import("node:fs/promises").then(fs=>fs.stat(path));
  if (stat.size===0 || stat.size>1000000) {
    const err=new Error("BRIDGE_INVALID_RAW_FILE_SIZE");
    err.permanent=true;
    throw err;
  }
  const raw=await readFile(path,"utf8");
  if (Buffer.byteLength(raw,"utf8")!==stat.size) {
    const err=new Error("BRIDGE_NON_UTF8_INPUT_REQUIRES_BINARY_ADAPTER");
    err.permanent=true;
    throw err;
  }
  const normalized=normalizeAnalyzerMessage(raw,settings.protocol,settings.profile);
  const root=settings.origin+"/api/integrations/analyzers/"+settings.analyzerId;
  const auth={authorization:"Bearer "+token};
  await lisPost(root+"/messages",{
    protocol:normalized.protocol,rawPayload:raw,
  },{...auth,"x-bridge-message-id":normalized.bridgeMessageId},sender);
  await lisPost(root+"/results",{
    bridgeMessageId:normalized.bridgeMessageId,
    observations:normalized.observations,
  },auth,sender);
  return {bridgeMessageId:normalized.bridgeMessageId,observationCount:normalized.observations.length};
}

export async function pollReadyFiles(settings,token,sender=fetch) {
  if (typeof token!=="string"||token.length<32||token.length>512) throw Error("BRIDGE_TOKEN_REQUIRED");
  await Promise.all([settings.archivedDir,settings.rejectedDir].map(x=>mkdir(x,{recursive:true})));
  const ready=(await readdir(settings.inputDir)).filter(x=>x.endsWith(".ready")).sort();
  const results=[];
  for (const name of ready) {
    const path=join(settings.inputDir,name);
    const suffix=randomUUID();
    try {
      const result=await processReadyFile(settings,path,token,sender);
      await rename(path,join(settings.archivedDir,basename(name)+"."+suffix+".sent"));
      results.push({name,status:"SENT_TO_LIS_STAGING",...result});
    } catch(err) {
      if (err instanceof UnsupportedAnalyzerFrame || err?.permanent) {
        const reason=err instanceof UnsupportedAnalyzerFrame ? err.code : (err.remoteCode || err.message);
        // Never include raw clinical content or authentication tokens in logs.
        await rename(path,join(settings.rejectedDir,basename(name)+"."+suffix+".rejected"));
        await writeFile(join(settings.rejectedDir,basename(name)+"."+suffix+".error.json"),
          JSON.stringify({reason,time:new Date().toISOString()})+"\n",{flag:"wx"});
        results.push({name,status:"REJECTED",reason});
      } else {
        results.push({name,status:"RETRY_PENDING",reason:err?.message||"REMOTE_ERROR"});
      }
    }
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const file=process.argv[2];
  if(!file) throw Error("Usage: node bridge/file-worker.mjs /path/to/bridge-config.json");
  const settings=validateBridgeSettings(JSON.parse(await readFile(file,"utf8")));
  const token=process.env.ANALYZER_BRIDGE_TOKEN;
  const intervalMs=Number(process.env.BRIDGE_POLL_INTERVAL_MS||5000);
  if(!Number.isInteger(intervalMs)||intervalMs<1000||intervalMs>60000) throw Error("BRIDGE_INTERVAL_INVALID");
  let stopping=false;
  process.on("SIGTERM",()=>{stopping=true;});
  process.on("SIGINT",()=>{stopping=true;});
  // Single-worker instance per spool directory; deploy supervisor must enforce
  // this to avoid races between independent OS processes.
  while(!stopping) {
    const results=await pollReadyFiles(settings,token);
    for(const result of results) console.log(JSON.stringify(result));
    if(stopping)break;
    await new Promise(resolveSleep=>setTimeout(resolveSleep,intervalMs));
  }
}
