import mysql from "mysql2/promise";
import { open, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { F3_TARGET_LINEAGE_TYPE } from "../../src/lib/f3-legacy-target-reconciliation.ts";

const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const LIMIT=500;
const MAX=3_000_000;

/**
 * Private, tenant-scoped read-only MariaDB export for F3 reconciliation.
 * Contents are sensitive private HMAC identity material, NEVER a public
 * GitHub artifact, browser response or email. Output is chmod 0600 (new
 * file only) and errors are redacted. Source values are never selected.
 */
export async function exportF3TargetLineage({
  databaseUrl,organizationId,sourceSha256,outputPath,caFile=null,
}){
  if(!UUID.test(organizationId)||!SHA.test(sourceSha256)||
     typeof databaseUrl!=="string"||!databaseUrl ||
     typeof outputPath!=="string"||!outputPath)
    throw Error("f3_export_invalid_arguments");
  const url=new URL(databaseUrl);
  if(!["mysql:","mariadb:"].includes(url.protocol))
    throw Error("f3_export_database_url_invalid");
  const host=url.hostname.replace(/^\[|\]$/g,"");
  const local=["localhost","127.0.0.1","::1"].includes(host);
  if(!local&&(!caFile||!isAbsolute(caFile)))
    throw Error("f3_remote_database_tls_ca_required");
  const db=await mysql.createConnection({
    host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),
    database:url.pathname.replace(/^\//,""),
    ...(!local?{ssl:{ca:await readFile(caFile,"utf8"),rejectUnauthorized:true}}:{}),
  });
  try{
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await db.query("START TRANSACTION READ ONLY");
    const [organization]=await db.execute(
      "SELECT id FROM organizations WHERE id=? LIMIT 1",[organizationId]);
    if(organization.length!==1)throw Error("f3_export_tenant_not_found");
    const rows=[];let cursor="";
    for(;;){
      const [page]=await db.execute(
        "SELECT id,source_table,source_sha256,source_schema_sha256,"+
        "digest_key_id,row_digest,occurrence,classification,target_type,"+
        "target_id,batch_id,import_row_id,revision "+
        "FROM legacy_catalog_row_lineage "+
        "WHERE organization_id=? AND source_sha256=? AND id>? "+
        "ORDER BY id ASC LIMIT ?",
        [organizationId,sourceSha256,cursor,LIMIT]);
      if(!page.length)break;
      for(const row of page){
        rows.push({
          sourceTable:row.source_table,sourceSha256:row.source_sha256,
          sourceSchemaSha256:row.source_schema_sha256,
          digestKeyId:row.digest_key_id,rowDigest:row.row_digest,
          occurrence:Number(row.occurrence),
          classification:row.classification,
          targetType:row.target_type,targetId:row.target_id,
          batchId:row.batch_id,importRowId:row.import_row_id,
          revision:Number(row.revision),
        });
      }
      if(rows.length>MAX)throw Error("f3_export_rows_limit");
      cursor=page[page.length-1].id;
      if(page.length<LIMIT)break;
    }
    const payload={
      schemaVersion:1,evidenceType:F3_TARGET_LINEAGE_TYPE,
      organizationId,sourceSha256,rows,
    };
    // Commit read-only consistent snapshot before writing to the output.
    await db.query("COMMIT");
    const file=await open(outputPath,"wx",0o600);
    try{await file.writeFile(JSON.stringify(payload));}
    finally{await file.close();}
    return {exportedRows:rows.length,privateFileCreated:true,
      operationalCertification:false};
  }finally{
    await db.query("ROLLBACK").catch(()=>{});
    await db.end();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);
  if(args.length!==6||args[0]!=="--organization"||
     args[2]!=="--source-sha256"||args[4]!=="--output"){
    process.stderr.write("Usage: node --experimental-strip-types scripts/legacy/export-target-lineage.mjs --organization UUID --source-sha256 HEX --output NEW_PRIVATE_FILE.json\n");
    process.exitCode=2;
  }else{
    try{
      const result=await exportF3TargetLineage({
        databaseUrl:process.env.DATABASE_URL,organizationId:args[1],
        sourceSha256:args[3],outputPath:args[5],
        caFile:process.env.FAMILY_LAB_F3_DB_TLS_CA||null,
      });
      process.stdout.write(JSON.stringify(result)+"\n");
    }catch{
      process.stderr.write("F3 private target lineage export rejected.\n");
      process.exitCode=1;
    }
  }
}
