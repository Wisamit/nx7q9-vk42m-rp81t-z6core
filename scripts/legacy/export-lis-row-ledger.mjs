import {open,unlink} from "node:fs/promises";
import {pathToFileURL} from "node:url";
import mysql from "mysql2/promise";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
/**
 * PRIVATE local, read-only, repeatable-read export of a single organization's
 * source-HMAC lineage records. Never print rows, SHA, identifiers or secrets.
 * Use database credentials authorized for this organization only.
 */
export async function exportPrivateF3Ledger({organizationId,sourceSha256,digestKeyId,
  outputPath,databaseUrl}){
  if(!UUID.test(organizationId)||!SHA.test(sourceSha256)||!SHA.test(digestKeyId)||
     typeof outputPath!=="string"||!outputPath.endsWith(".json")||
     !databaseUrl)throw Error("f3_invalid_export_context");
  const u=new URL(databaseUrl);
  const db=await mysql.createConnection({host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1),timezone:"Z"});
  let file=null,count=0,bytes=0;
  try{
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const [active]=await db.execute(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE'",
      [organizationId]);
    if(active.length!==1)throw Error("f3_org_scope_unavailable");
    file=await open(outputPath,"wx",0o600);
    await file.write("[");
    let cursor="";
    for(;;){
      const [rows]=await db.execute(
        "SELECT id,source_sha256 sourceSha256,source_table sourceTable,source_schema_sha256 sourceSchemaSha256,digest_key_id digestKeyId,row_digest rowDigest,occurrence,revision,classification,target_type targetType,target_id targetId,created_by_user_id createdByUserId,mapped_by_user_id mappedByUserId,reviewed_by_user_id reviewedByUserId,reviewed_at reviewedAt FROM legacy_catalog_row_lineage WHERE organization_id=? AND source_sha256=? AND digest_key_id=? AND id>? ORDER BY id ASC LIMIT 500",
        [organizationId,sourceSha256,digestKeyId,cursor]);
      if(rows.length===0)break;
      for(const row of rows){
        cursor=row.id;
        const {id:_id,...entry}=row;
        entry.reviewedAt=entry.reviewedAt instanceof Date?
          entry.reviewedAt.toISOString():entry.reviewedAt;
        const json=JSON.stringify(entry);
        bytes+=Buffer.byteLength(json)+1;
        if(++count>3_000_000||bytes>200*1024*1024)
          throw Error("f3_private_export_limit");
        await file.write((count===1?"":",")+json);
      }
      if(rows.length<500)break;
    }
    await file.write("]");
    await file.sync();
    await file.close();file=null;
    await db.query("ROLLBACK");
    return {state:"F3_PRIVATE_LINEAGE_EXPORTED",rows:count,
      sourceIndependentVerified:false,cutoverApproved:false};
  }catch(err){
    if(file){await file.close().catch(()=>{});await unlink(outputPath).catch(()=>{});}
    await db.query("ROLLBACK").catch(()=>{});
    throw err;
  }finally{await db.end();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const a=process.argv.slice(2);
  if(a.length!==8||a[0]!=="--organization"||a[2]!=="--source-sha"||
     a[4]!=="--digest-key"||a[6]!=="--out"){
    process.stderr.write("Usage: export-lis-row-ledger.mjs --organization UUID --source-sha SHA256 --digest-key KEY_ID --out PRIVATE.json\n");
    process.exitCode=2;
  }else{
    try{
      const result=await exportPrivateF3Ledger({
        organizationId:a[1],sourceSha256:a[3],digestKeyId:a[5],
        outputPath:a[7],databaseUrl:process.env.DATABASE_URL,
      });
      process.stdout.write("Private F3 ledger exported: "+result.rows+" rows\n");
    }catch{
      process.stderr.write("Private F3 ledger export rejected\n");
      process.exitCode=1;
    }
  }
}
