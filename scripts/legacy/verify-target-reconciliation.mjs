import { lstat,readFile } from "node:fs/promises";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkPrivateLegacyEvidencePackage,loadLineagePages,
} from "./verify-evidence-package.mjs";
import {
  LEGACY_COVERAGE_MAX_BYTES,parseLegacySourceCoverage,
} from "../../src/lib/legacy-source-coverage.ts";
import {
  parseF3TargetLineageExport,reconcileF3LegacyTargets,
} from "../../src/lib/f3-legacy-target-reconciliation.ts";

const MAX_TARGET_FILE_BYTES=300*1024*1024;
async function jsonFile(path,max){
  const f=await lstat(path);
  if(!f.isFile()||f.isSymbolicLink()||f.size>max)
    throw Error("f3_private_input_invalid");
  return JSON.parse(await readFile(path,"utf8"));
}
/**
 * Runs only on the operator's private computer. No raw source values are read
 * or printed: SHA/header anchoring + exact HMAC page validation first, then
 * reconciliation against a separately produced tenant-scoped SQL ledger dump.
 * CLI never considers a disk JSON file independent DB authentication.
 */
export async function checkF3PrivateTargetReconciliation(input){
  const {mdb,coverage,lineageDir,targetExport,organizationId}=input;
  if(!/\.(?:mdb|accdb)$/i.test(basename(mdb)))
    throw Error("f3_mdb_extension_invalid");
  if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(organizationId))
    throw Error("f3_organization_invalid");
  const source=await checkPrivateLegacyEvidencePackage(
    mdb,coverage,lineageDir,undefined);
  const [coverageData,pages,targetData]=await Promise.all([
    jsonFile(coverage,LEGACY_COVERAGE_MAX_BYTES),
    loadLineagePages(lineageDir),
    jsonFile(targetExport,MAX_TARGET_FILE_BYTES),
  ]);
  const report=reconcileF3LegacyTargets({
    coverage:parseLegacySourceCoverage(coverageData),
    lineage:pages,
    targetExport:parseF3TargetLineageExport(targetData),
    expectedOrganizationId:organizationId,
  });
  if(report.sourceRows!==source.masterRows)
    throw Error("f3_source_manifest_count_diverged");
  return {...report,sourceMetadataVerified:true,
    sourceRowsIndependentlyRecomputedFromMdb:false,
    targetMappingCertified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const values=process.argv.slice(2);
  if(values.length!==10||
     values[0]!=="--mdb" || values[2]!=="--coverage" ||
     values[4]!=="--lineage-dir" || values[6]!=="--target-export" ||
     values[8]!=="--organization"){
    process.stderr.write("Usage: node --experimental-strip-types scripts/legacy/verify-target-reconciliation.mjs --mdb SOURCE.mdb --coverage COVERAGE.json --lineage-dir PRIVATE_PAGES --target-export PRIVATE_TARGET.json --organization UUID\n");
    process.exitCode=2;
  }else{
    try{
      const result=await checkF3PrivateTargetReconciliation({
        mdb:values[1],coverage:values[3],lineageDir:values[5],
        targetExport:values[7],organizationId:values[9],
      });
      process.stdout.write(JSON.stringify(result,null,2)+"\n");
      if(result.state==="GAPS_REMAIN")process.exitCode=3;
    }catch{
      // Never print private paths, HMAC row digests, original values or IDs.
      process.stderr.write("F3 target reconciliation rejected: private source/target evidence invalid.\n");
      process.exitCode=1;
    }
  }
}
