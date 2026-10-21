import {lstat,readFile,readdir} from "node:fs/promises";
import {basename,join} from "node:path";
import {pathToFileURL} from "node:url";
import {checkPrivateLegacyEvidencePackage} from "./verify-evidence-package.mjs";
import {parseLegacySourceCoverage} from "../../src/lib/legacy-source-coverage.ts";
import {parseLegacyRowManifest} from "../../src/lib/catalog-legacy-row-lineage.ts";
import {reconcileF3LegacyRowParity} from "../../src/lib/legacy-f3-row-parity.ts";

async function readLimited(path,limit){
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit)
    throw Error("f3_invalid_private_file");
  return JSON.parse(await readFile(path,"utf8"));
}
async function pages(dir){
  const stat=await lstat(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink())
    throw Error("f3_invalid_page_directory");
  const names=await readdir(dir);
  if(names.length<1||names.length>6000)
    throw Error("f3_invalid_page_count");
  const result=[];
  for(const name of names){
    if(!/^legacy-row-hashes-[A-Za-z0-9_]+-[0-9]{5}\.json$/.test(name))
      throw Error("f3_invalid_page_filename");
    const page=parseLegacyRowManifest(await readLimited(join(dir,name),262144));
    const expected="legacy-row-hashes-"+page.tableName.replace(/[^A-Za-z0-9]/g,"_")+"-"+
      String(page.chunkIndex).padStart(5,"0")+".json";
    if(name!==expected)throw Error("f3_page_name_mismatch");
    result.push(page);
  }
  return result;
}
/**
 * All inputs stay on the operator's private workstation.
 * The ledger must be a complete exported, tenant-scoped DB snapshot.
 * No LIVE target existence is inferred from an untrusted file.
 */
export async function checkPrivateF3Lineage(mdb,coveragePath,lineageDir,ledgerPath){
  await checkPrivateLegacyEvidencePackage(mdb,coveragePath,lineageDir);
  const coverage=parseLegacySourceCoverage(await readLimited(coveragePath,65536));
  const persisted=await readLimited(ledgerPath,200*1024*1024);
  if(!Array.isArray(persisted))throw Error("f3_ledger_array_required");
  return reconcileF3LegacyRowParity({
    source:{sourceName:basename(mdb),sourceSha256:coverage.sourceSha256,
      sourceBytes:coverage.sourceBytes},
    coverage,lineage:await pages(lineageDir),persisted,
  });
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const a=process.argv.slice(2);
  if(a.length!==8||a[0]!=="--mdb"||a[2]!=="--coverage"||
     a[4]!=="--lineage-dir"||a[6]!=="--ledger-json"){
    process.stderr.write("Usage: reconcile-source-ledger.mjs --mdb FILE.mdb --coverage FILE.json --lineage-dir DIRECTORY --ledger-json PRIVATE_LEDGER.json\n");
    process.exitCode=2;
  }else{
    try{
      const report=await checkPrivateF3Lineage(a[1],a[3],a[5],a[7]);
      process.stdout.write(JSON.stringify(report)+"\n");
    }catch{
      // Don't print source values, file paths, or source digests.
      process.stderr.write("F3 private reconciliation rejected\n");
      process.exitCode=1;
    }
  }
}
