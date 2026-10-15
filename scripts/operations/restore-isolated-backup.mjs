/**
 * Stage 129 conservative restore drill: import only into a BRAND NEW sandbox
 * database whose name is explicitly restricted. No production restore mode.
 * A successful import is technical evidence, not an approved DR drill.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { backupEncryptionKey, decryptBackupToSink } from "./backup-archive.mjs";
import { parseBackupDatabaseUrl, dumpDefaultsFile, verifyBackupArchive } from "./create-encrypted-backup.mjs";

export function recoveryDatabaseName(name,live) {
  if(typeof name!=="string"||!/^family_lab_restore_[a-z0-9_]{8,40}$/.test(name)||
      name===live) throw Error("RESTORE_DATABASE_NOT_ISOLATED");
  return name;
}
export async function restoreIsolated(archive, env=process.env) {
  const config=parseBackupDatabaseUrl(env.DATABASE_URL,env.FAMILY_LAB_BACKUP_DB_TLS_CA);
  const name=recoveryDatabaseName(env.FAMILY_LAB_BACKUP_RESTORE_DATABASE,config.db);
  if(!env.FAMILY_LAB_RESTORE_EXPLICIT_ACK ||
      env.FAMILY_LAB_RESTORE_EXPLICIT_ACK!=="ISOLATED_DATABASE_ONLY"){
    throw Error("RESTORE_ISOLATED_ACK_REQUIRED");
  }
  // Authenticate the entire encrypted archive before any SQL is executed.
  const verified=await verifyBackupArchive(archive,env);
  const key=backupEncryptionKey(env.FAMILY_LAB_BACKUP_KEY);
  const connection=await mysql.createConnection({
    host:config.host,port:config.port,user:config.user,password:config.password,
    ...(config.caFile?{ssl:{ca:await readFile(config.caFile,"utf8"),rejectUnauthorized:true}}:{}),
    multipleStatements:false,
  });
  let created=false;
  const configFile=resolve(env.FAMILY_LAB_BACKUP_DIR || "/not-configured")+"/."+randomUUID()+".restore.cnf";
  try{
    const [existing]=await connection.execute(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",[name]);
    if(existing.length)throw Error("RESTORE_TARGET_ALREADY_EXISTS");
    // The name is a fully validated identifier, never a request-supplied SQL string.
    await connection.query("CREATE DATABASE \`"+name+"\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
    created=true;
    const fd=await open(configFile,"wx",0o600);
    try{await fd.writeFile(dumpDefaultsFile(config));await fd.sync();}
    finally{await fd.close();}
    const executable=env.FAMILY_LAB_RESTORE_BINARY||"mariadb";
    const child=spawn(executable,["--defaults-extra-file="+configFile,
      "--default-character-set=utf8mb4","--binary-mode",name],{
      stdio:["pipe","ignore","pipe"],shell:false,
      env:{...process.env,MYSQL_PWD:"",MARIADB_PWD:""},
    });
    child.stderr.on("data",()=>{}); // Never log restored SQL or secrets.
    const closed=new Promise((ok,fail)=>{
      child.once("error",()=>fail(Error("RESTORE_CLIENT_NOT_AVAILABLE")));
      child.once("close",code=>code===0?ok():fail(Error("RESTORE_SQL_IMPORT_FAILED")));
    });
    try { await Promise.all([decryptBackupToSink(archive,key,child.stdin),closed]); }
    catch(error){child.kill("SIGTERM");throw error;}
    const [tables]=await connection.execute(
      "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema=?",[name]);
    if(!tables.length||Number(tables[0].total)<1)throw Error("RESTORE_NO_TABLES_IMPORTED");
    return {status:"ISOLATED_SQL_IMPORTED_REQUIRES_HUMAN_DR_VERIFICATION",
      recoveryDatabase:name,archiveName:verified.archiveName,restoredToProduction:false,
      verifiedClinicalHistory:false};
  }catch(error){
    // Never leave a failed/incomplete recovery database to be mistaken for a
    // usable backup. This cleanup is restricted to the database created here.
    if(created)await connection.query("DROP DATABASE \`"+name+"\`").catch(()=>{});
    throw error;
  }finally{
    await rm(configFile,{force:true}).catch(()=>{});
    await connection.end();
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv[2]!=="restore-isolated"||process.argv.length!==4)
      throw Error("RESTORE_USAGE_ISOLATED_ONLY");
    console.log(JSON.stringify(await restoreIsolated(process.argv[3])));
  }catch(error){
    console.error(JSON.stringify({status:"FAILED",
      code:error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:"RESTORE_OPERATION_FAILED"}));
    process.exitCode=1;
  }
}
