/**
 * Conservative bidirectional boundary for device-specific vendor adapters.
 * A claim is only a locally durably staged envelope, NEVER a device send.
 * A separate approved adapter records exact wire bytes and the instrument
 * disposition in a receipt. This worker only relays that attestation to LIS.
 */
import { createHash, randomUUID } from "node:crypto";
import { open, mkdir, readdir, readFile, rename, lstat, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBridgeSettings } from "./file-worker.mjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LEASE = /^[0-9a-f]{64}$/;
const MAX_FILE_BYTES = 1_100_000;

function fail(code) { const err = new Error(code); err.code = code; throw err; }
function isFileName(value) { return typeof value === "string" && UUID.test(value); }
function fileBase(order) { return order.workOrderId + "." + order.attempt; }
function pathsFor(settings, base) {
  return {
    pending: join(settings.pendingDir, base + ".claim.json"),
    receipt: join(settings.receiptDir, base + ".receipt.json"),
    done: join(settings.completedDir, base + ".done.json"),
    archivedClaim: join(settings.completedDir, base + ".claim.json"),
    archivedReceipt: join(settings.completedDir, base + ".receipt.json"),
  };
}
function finiteIso(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) fail("OUTBOUND_LEASE_DATE_INVALID");
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail("OUTBOUND_LEASE_DATE_INVALID");
  return timestamp;
}
function ensureToken(token) {
  if (typeof token !== "string" || token.length < 32 || token.length > 512) fail("OUTBOUND_TOKEN_REQUIRED");
}
export function validateOutboundSettings(input) {
  const common = validateBridgeSettings(input);
  const target = input.outbound;
  if (!target || typeof target !== "object" || Array.isArray(target)
    || target.enabled !== true || target.vendorApproved !== true
    || target.mode !== "FILE_HANDOFF") fail("OUTBOUND_APPROVED_FILE_HANDOFF_REQUIRED");
  if (typeof target.deviceKey !== "string" || !/^[A-Za-z0-9._:-]{1,150}$/.test(target.deviceKey)) {
    fail("OUTBOUND_DEVICE_KEY_REQUIRED");
  }
  const names = ["pendingDir", "receiptDir", "completedDir", "quarantineDir"];
  const entries = names.map(name => [name, target[name] && resolve(target[name])]);
  if (entries.some(([,value]) => typeof value !== "string")) fail("OUTBOUND_DIRECTORY_REQUIRED");
  const allDirs = [common.inputDir, common.archivedDir, common.rejectedDir, ...entries.map(([,value]) => value)];
  if (new Set(allDirs).size !== allDirs.length) fail("OUTBOUND_DIRECTORIES_OVERLAP");
  // Never nest one writable spool under another. A renamed claim must not
  // accidentally become an inbound .ready message or a public static asset.
  if (allDirs.some((dir,i) => allDirs.some((other,j) => i !== j && dir.startsWith(other + "/")))) {
    fail("OUTBOUND_DIRECTORIES_NESTED");
  }
  return { ...common, deviceKey: target.deviceKey, ...Object.fromEntries(entries) };
}
async function atomicWrite(dir, name, data) {
  const temp = join(dir, "." + randomUUID() + ".partial");
  const fd = await open(temp, "wx", 0o600);
  try {
    await fd.writeFile(data, "utf8");
    await fd.sync();
  } finally { await fd.close(); }
  await rename(temp, join(dir, name));
  try {
    const folder = await open(dir,"r");
    try { await folder.sync(); } finally { await folder.close(); }
  } catch(error) { if (process.platform !== "win32") throw error; }
}
async function readPrivateJson(path) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size <= 0 || stat.size > MAX_FILE_BYTES) fail("OUTBOUND_UNTRUSTED_SPOOL_FILE");
  const bytes = await readFile(path);
  if (bytes.length !== stat.size) fail("OUTBOUND_FILE_CHANGED_DURING_READ");
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("OUTBOUND_INVALID_UTF8"); }
  try { return JSON.parse(text); } catch { fail("OUTBOUND_INVALID_JSON"); }
}
async function post(settings, suffix, body, token, sender) {
  const url = settings.origin + "/api/integrations/analyzers/" + settings.analyzerId + suffix;
  const response = await sender(url, {
    method: "POST",
    headers: { "content-type":"application/json", authorization:"Bearer " + token },
    body: JSON.stringify(body), redirect:"error", cache:"no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response || typeof response.status !== "number") fail("OUTBOUND_REMOTE_RESPONSE_INVALID");
  if (response.status === 401 || response.status === 403) fail("OUTBOUND_CREDENTIAL_REJECTED");
  if (response.status === 409) fail("OUTBOUND_LEASE_CONFLICT_REQUIRES_RECONCILIATION");
  if (response.status >= 400) fail("OUTBOUND_LIS_REJECTED_OR_UNAVAILABLE");
  const json = await response.json().catch(() => null);
  if (!json || json.status !== "ok") fail("OUTBOUND_REMOTE_RESPONSE_INVALID");
  return json;
}
function validateClaim(command, settings, now) {
  if (!command || typeof command !== "object" || !isFileName(command.workOrderId)
    || !Number.isInteger(command.attempt) || command.attempt < 1
    || !LEASE.test(command.leaseToken || "")
    || command.bridgeDeviceKey !== settings.deviceKey) fail("OUTBOUND_CLAIM_DEVICE_OR_IDENTITY_INVALID");
  const expiry = finiteIso(command.leaseExpiresAt);
  if (expiry <= now + 5000) fail("OUTBOUND_CLAIM_EXPIRES_TOO_SOON");
  for (const field of ["accessionNumber", "specimenBarcode", "lisTestCode", "analyzerTestCode"]) {
    if (typeof command[field] !== "string" || !command[field] || command[field].length > 150) {
      fail("OUTBOUND_CLAIM_SNAPSHOT_INVALID");
    }
  }
  return { ...command, leaseExpiresAt: command.leaseExpiresAt };
}
function validateReceipt(input, order) {
  if (!input || typeof input !== "object" || input.workOrderId !== order.workOrderId
    || input.attempt !== order.attempt
    || !["ACCEPTED","RETRY","REJECTED"].includes(input.code)) fail("OUTBOUND_RECEIPT_MISMATCH");
  if (input.message !== undefined && (typeof input.message !== "string" || input.message.length > 2000)) {
    fail("OUTBOUND_RECEIPT_NOTE_INVALID");
  }
  if (input.rawPayload !== undefined && typeof input.rawPayload !== "string") fail("OUTBOUND_RECEIPT_RAW_INVALID");
  const bytes = Buffer.byteLength(input.rawPayload || "", "utf8");
  if (bytes > 1_000_000 || (input.code === "ACCEPTED" && bytes === 0)) fail("OUTBOUND_RECEIPT_RAW_REQUIRED");
  // No unsupported device-level ACK inference: only an actual vendor adapter
  // can author an accepted receipt containing exact transmitted wire evidence.
  return {
    code: input.code,
    message: input.message || "",
    ...(input.rawPayload !== undefined ? { rawPayload: input.rawPayload } : {}),
  };
}
async function finishLocally(settings, base) {
  const p = pathsFor(settings, base);
  for (const [from,to] of [[p.pending,p.archivedClaim],[p.receipt,p.archivedReceipt]]) {
    try { await rename(from,to); }
    catch(error) { if (error?.code !== "ENOENT") throw error; }
  }
}
async function recoverFinished(settings) {
  const done = (await readdir(settings.completedDir)).filter(name => name.endsWith(".done.json"));
  for (const name of done) {
    const base = name.slice(0,-".done.json".length);
    if (!/^[0-9a-f-]{36}\.[1-9][0-9]*$/i.test(base)) fail("OUTBOUND_DONE_FILENAME_INVALID");
    await finishLocally(settings,base);
  }
}
async function pollExclusive(settings, token, sender, now) {
  await recoverFinished(settings);
  const outstanding = (await readdir(settings.pendingDir)).filter(name => name.endsWith(".claim.json"));
  const receipts = (await readdir(settings.receiptDir)).filter(name => name.endsWith(".receipt.json"));
  if (outstanding.length > 1) return { status:"MULTIPLE_CLAIMS_REQUIRE_RECONCILIATION" };
  if (outstanding.length) {
    const name = outstanding[0];
    const claim = await readPrivateJson(join(settings.pendingDir,name));
    const base = fileBase(claim);
    if (!isFileName(claim.workOrderId) || !Number.isInteger(claim.attempt)
      || name !== base + ".claim.json" || claim.bridgeDeviceKey !== settings.deviceKey
      || !LEASE.test(claim.leaseToken || "")) fail("OUTBOUND_PENDING_CLAIM_INVALID");
    const p = pathsFor(settings, base);
    const receiptName = base + ".receipt.json";
    if (receipts.some(value => value !== receiptName)) return { status:"ORPHAN_RECEIPT_REQUIRES_RECONCILIATION" };
    if (!receipts.includes(receiptName)) {
      return { status:finiteIso(claim.leaseExpiresAt) <= now
        ? "LEASE_EXPIRED_UNRESOLVED_REQUIRES_RECONCILIATION"
        : "WAITING_FOR_VENDOR_RECEIPT" };
    }
    let receipt;
    try { receipt = validateReceipt(await readPrivateJson(p.receipt),claim); }
    catch { return { status:"RECEIPT_INVALID_REQUIRES_RECONCILIATION" }; }
    if (finiteIso(claim.leaseExpiresAt) <= now) {
      return { status:"LEASE_EXPIRED_RECEIPT_REQUIRES_RECONCILIATION" };
    }
    const outcome = await post(settings,
      "/work-orders/" + claim.workOrderId + "/ack",
      { ...receipt, leaseToken:claim.leaseToken },token,sender);
    const expected = receipt.code === "ACCEPTED" ? ["ACKNOWLEDGED"]
      : receipt.code === "RETRY" ? ["RETRY_WAIT","DEAD_LETTER"] : ["DEAD_LETTER"];
    if (!expected.includes(outcome.workOrderStatus) || outcome.workOrderId !== claim.workOrderId) {
      fail("OUTBOUND_ACK_DISPOSITION_MISMATCH");
    }
    await atomicWrite(settings.completedDir,base + ".done.json",
      JSON.stringify({
        workOrderId:claim.workOrderId,attempt:claim.attempt,code:receipt.code,
        wireSha256:receipt.rawPayload ? createHash("sha256").update(receipt.rawPayload).digest("hex") : null,
        workOrderStatus:outcome.workOrderStatus,completedAt:new Date(now).toISOString(),
      }) + "\n");
    await finishLocally(settings,base);
    return { status:"VENDOR_RECEIPT_ACKNOWLEDGED" };
  }
  if (receipts.length) return { status:"ORPHAN_RECEIPT_REQUIRES_RECONCILIATION" };
  const response = await post(settings,"/work-orders/claim",{ limit:1 },token,sender);
  if (response.deliveryGuarantee !== "AT_LEAST_ONCE" || response.bridgeMustDeduplicateBy !== "workOrderId"
    || !Array.isArray(response.workOrders) || response.workOrders.length > 1) fail("OUTBOUND_CLAIM_CONTRACT_INVALID");
  if (!response.workOrders.length) return { status:"NO_WORK_ORDERS" };
  const claim = validateClaim(response.workOrders[0],settings,now);
  const completed = await readdir(settings.completedDir);
  if (completed.some(name => name.startsWith(claim.workOrderId + ".") && name.endsWith(".done.json"))) {
    // A repeated work order may already have reached a physical instrument.
    // Never write a second device handoff without vendor adjudication.
    return { status:"PREVIOUS_DEVICE_ATTEMPT_REQUIRES_RECONCILIATION" };
  }
  const base = fileBase(claim);
  await atomicWrite(settings.pendingDir,base + ".claim.json",JSON.stringify(claim) + "\n");
  return { status:"CLAIM_DURABLY_STAGED_NOT_SENT" };
}
export async function pollOutbound(settings, token, sender=fetch, now=Date.now()) {
  ensureToken(token);
  for (const path of [settings.pendingDir,settings.receiptDir,settings.completedDir,settings.quarantineDir]) {
    await mkdir(path,{recursive:true});
  }
  const lock = join(settings.pendingDir,".worker.lock");
  try { await mkdir(lock); }
  catch(error) { if (error?.code === "EEXIST") fail("OUTBOUND_WORKER_ALREADY_ACTIVE_OR_STALE_LOCK"); throw error; }
  try { return await pollExclusive(settings,token,sender,now); }
  finally { await rm(lock,{recursive:false,force:true}); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.ANALYZER_BRIDGE_OUTBOUND_ENABLED !== "true") fail("OUTBOUND_OPT_IN_ENV_REQUIRED");
  const config = process.argv[2];
  if (!config) fail("OUTBOUND_CONFIG_PATH_REQUIRED");
  const settings = validateOutboundSettings(JSON.parse(await readFile(config,"utf8")));
  const token = process.env.ANALYZER_BRIDGE_TOKEN;
  const pollMs = Number(process.env.BRIDGE_OUTBOUND_POLL_MS || 10000);
  if (!Number.isInteger(pollMs) || pollMs < 1000 || pollMs > 60000) fail("OUTBOUND_POLL_INTERVAL_INVALID");
  let stopped=false;
  for (const signal of ["SIGTERM","SIGINT"]) process.on(signal,()=>{stopped=true;});
  while (!stopped) {
    const outcome = await pollOutbound(settings,token);
    console.log(JSON.stringify({status:outcome.status})); // Never log clinical snapshots or bearer tokens.
    if (outcome.status.includes("REQUIRES_RECONCILIATION")) {
      fail("OUTBOUND_OPERATOR_RECONCILIATION_REQUIRED");
    }
    if (!stopped) await new Promise(done=>setTimeout(done,pollMs));
  }
}
