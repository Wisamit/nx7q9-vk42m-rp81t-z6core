/**
 * Private Hostinger/VPS CLI. No HTTP routes, no web-facing backup directory.
 * Run from a supervised cron job with a trusted OS account and OS-level secrets.
 *
 * create: full MariaDB SQL dump (includes database-held attachment_content BLOBs),
 *         compressed and AES-256-GCM encrypted; optionally offsite via rclone.
 * verify <archive>: authenticated decrypt/CRC and SHA-256 check, NO restore.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rm, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { backupEncryptionKey, encryptBackupStream, verifyEncryptedBackup, durablePublish } from "./backup-archive.mjs";

export function parseBackupDatabaseUrl(value, caFile = null) {
  if (!value) throw Error("BACKUP_DATABASE_URL_REQUIRED");
  let u;
  try { u = new URL(value); } catch { throw Error("BACKUP_DATABASE_URL_INVALID"); }
  const db = decodeURIComponent(u.pathname.slice(1));
  if (!["mysql:","mariadb:"].includes(u.protocol) ||
      !/^[A-Za-z0-9_]+$/.test(db) || !u.username || !u.hostname ||
      !/^[0-9]+$/.test(u.port || "3306") ||
      Number(u.port || 3306) < 1 || Number(u.port || 3306) > 65535) {
    throw Error("BACKUP_DATABASE_URL_INVALID");
  }
  const user = decodeURIComponent(u.username), password = decodeURIComponent(u.password);
  const host = u.hostname.replace(/^\[|\]$/g,"");
  for (const value of [user,password,host]) {
    if (/[\x00-\x1f\x7f]/.test(value)) throw Error("BACKUP_DATABASE_CREDENTIAL_INVALID");
  }
  const local = ["localhost","127.0.0.1","::1"].includes(host);
  if (!local && (!caFile || !isAbsolute(caFile))) {
    throw Error("BACKUP_REMOTE_DATABASE_CA_REQUIRED");
  }
  return { db, user, password, host, port: Number(u.port || 3306), caFile: local ? null : caFile };
}
function cnf(value) {
  return '"' + String(value).replaceAll("\\","\\\\").replaceAll('"','\\"') + '"';
}
export function dumpDefaultsFile(input) {
  return "[client]\nuser="+cnf(input.user)+"\npassword="+cnf(input.password)+
    "\nhost="+cnf(input.host)+"\nport="+input.port+
    (input.caFile ? "\nssl-ca="+cnf(input.caFile)+"\nssl-verify-server-cert\n" : "\n");
}
function runBinary(executable,args) {
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{stdio:["ignore","ignore","pipe"],shell:false});
    child.stderr.on("data",()=>{}); // Never persist/forward potentially sensitive output.
    child.once("error",()=>reject(Error("BACKUP_EXTERNAL_EXECUTION_FAILED")));
    child.once("close",code=>code===0 ? resolve() : reject(Error("BACKUP_EXTERNAL_COMMAND_FAILED")));
  });
}
export function backupOffsiteLocation(remote, file) {
  if (typeof remote !== "string" || !/^[A-Za-z0-9_-]+:[A-Za-z0-9_/-]+$/.test(remote) ||
      remote.includes("..") || remote.includes("//") || remote.endsWith("/")) {
    throw Error("BACKUP_OFFSITE_REMOTE_INVALID");
  }
  if (!/^family-lab-[0-9TZ-]+-[a-f0-9-]{36}\.flbak(?:\.manifest\.json)?$/.test(file)) {
    throw Error("BACKUP_ARCHIVE_NAME_INVALID");
  }
  return remote + "/" + file;
}
async function checkPrivateDirectory(path) {
  if (!isAbsolute(path)) throw Error("BACKUP_DIRECTORY_ABSOLUTE_REQUIRED");
  const directory=resolve(path), working=resolve(process.cwd());
  if (directory === working || directory.startsWith(working+sep)) {
    throw Error("BACKUP_DIRECTORY_MUST_BE_OUTSIDE_APPLICATION");
  }
  await mkdir(directory,{recursive:true,mode:0o700});
  const canonical=await realpath(directory);
  if(canonical!==directory)throw Error("BACKUP_DIRECTORY_SYMLINK_NOT_ALLOWED");
  await (await open(directory,"r")).close();
  return directory;
}
async function atomicPrivateJson(path,data){
  const partial=path+"."+randomUUID()+".partial";
  const fd=await open(partial,"wx",0o600);
  try { await fd.writeFile(JSON.stringify(data)+"\n");await fd.sync(); }
  finally {await fd.close();}
  await durablePublish(partial,path);
}

export async function createBackup(env=process.env, options={}){
  const key=backupEncryptionKey(env.FAMILY_LAB_BACKUP_KEY);
  const dsn=parseBackupDatabaseUrl(env.DATABASE_URL,env.FAMILY_LAB_BACKUP_DB_TLS_CA);
  const directory=await checkPrivateDirectory(env.FAMILY_LAB_BACKUP_DIR || "");
  const offsite=env.FAMILY_LAB_BACKUP_RCLONE_REMOTE || "";
  if(!offsite && env.FAMILY_LAB_BACKUP_ALLOW_LOCAL_ONLY!=="true"){
    throw Error("BACKUP_OFFSITE_REQUIRED");
  }
  // A protected local file is an intermediate artifact, not a proof of offsite DR.
  const stamp=new Date().toISOString().replace(/[:.]/g,"-");
  const name="family-lab-"+stamp+"-"+randomUUID()+".flbak";
  const archive=join(directory,name),temp=archive+".partial";
  const manifest=archive+".manifest.json";
  const config=join(directory,"."+randomUUID()+".client.cnf");
  const file=await open(config,"wx",0o600);
  try { await file.writeFile(dumpDefaultsFile(dsn)); await file.sync(); }
  finally {await file.close();}
  try{
    const binary=env.FAMILY_LAB_DUMP_BINARY || "mariadb-dump";
    // --defaults-extra-file MUST be the first argument; no DB password in argv.
    const flags=["--defaults-extra-file="+config,"--single-transaction","--quick",
      "--routines","--events","--triggers","--hex-blob","--skip-lock-tables",
      "--default-character-set=utf8mb4","--no-tablespaces",dsn.db];
    const processDump=spawn(binary,flags,{
      stdio:["ignore","pipe","pipe"],shell:false,
      env:{...process.env,MYSQL_PWD:"",MARIADB_PWD:""},
    });
    processDump.stderr.on("data",()=>{}); // Redact all native stderr.
    const close=new Promise((resolve,reject)=>{
      processDump.once("error",()=>reject(Error("BACKUP_DUMP_BINARY_MISSING")));
      processDump.once("close",code=>code===0 ? resolve() : reject(Error("BACKUP_DUMP_FAILED")));
    });
    let encryption;
    try{
      [encryption]=await Promise.all([encryptBackupStream(processDump.stdout,temp,key),close]);
    }catch(error){
      processDump.kill("SIGTERM");
      throw error;
    }
    await durablePublish(temp,archive);
    const meta={format:"FLBK1291",archiveName:name,createdAt:new Date().toISOString(),
      sizeBytes:encryption.sizeBytes,sha256:encryption.sha256,
      scope:"FULL_DATABASE_INCLUDING_ATTACHMENT_CONTENTS",
      backupStatus:"LOCAL_ENCRYPTED_CREATED",
      restoreVerified:false};
    await atomicPrivateJson(manifest,meta);
    await verifyEncryptedBackup(archive,key,meta);
    if(offsite){
      const remoteArchive=backupOffsiteLocation(offsite,name);
      const remoteManifest=backupOffsiteLocation(offsite,name+".manifest.json");
      await runBinary(env.FAMILY_LAB_RCLONE_BINARY||"rclone",
        ["copyto","--immutable",archive,remoteArchive]);
      await runBinary(env.FAMILY_LAB_RCLONE_BINARY||"rclone",
        ["copyto","--immutable",manifest,remoteManifest]);
      // A successful remote copy is not a cryptographic remote restore drill.
      return {archiveName:name,sha256:meta.sha256,status:"OFFSITE_TRANSFER_COMMAND_SUCCEEDED",
        restored:false};
    }
    return {archiveName:name,sha256:meta.sha256,status:"LOCAL_ONLY_DEVELOPMENT",
      restored:false};
  }catch(error){
    await rm(temp,{force:true}).catch(()=>{});
    throw error;
  }finally{
    await rm(config,{force:true});
  }
}
export async function verifyBackupArchive(path,env=process.env){
  const key=backupEncryptionKey(env.FAMILY_LAB_BACKUP_KEY);
  if(!isAbsolute(path))throw Error("BACKUP_VERIFY_ABSOLUTE_PATH_REQUIRED");
  if(!/^family-lab-[0-9TZ-]+-[a-f0-9-]{36}\.flbak$/.test(basename(path))){
    throw Error("BACKUP_ARCHIVE_NAME_INVALID");
  }
  const info=JSON.parse(await readFile(path+".manifest.json","utf8"));
  if(info.archiveName!==basename(path)||info.format!=="FLBK1291" ||
      info.scope!=="FULL_DATABASE_INCLUDING_ATTACHMENT_CONTENTS")throw Error("BACKUP_MANIFEST_INVALID");
  const checked=await verifyEncryptedBackup(path,key,info);
  return {archiveName:info.archiveName,sha256:info.sha256,status:"DECRYPTION_VERIFIED_NOT_RESTORED",
    plainBytes:checked.plainBytes,restored:false};
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const command=process.argv[2];
    const result=command==="create" && process.argv.length===3
      ? await createBackup()
      : command==="verify" && process.argv.length===4
        ? await verifyBackupArchive(process.argv[3])
        : null;
    if(!result)throw Error("BACKUP_USAGE_CREATE_OR_VERIFY");
    console.log(JSON.stringify(result)); // No paths, passwords or SQL.
  }catch(error){
    console.error(JSON.stringify({status:"FAILED",
      code:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:"BACKUP_OPERATION_FAILED"}));
    process.exitCode=1;
  }
}
