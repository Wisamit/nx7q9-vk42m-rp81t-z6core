import {closeSync,existsSync,openSync,readFileSync,statSync,writeFileSync}
  from "node:fs";
import {resolve} from "node:path";
import {f3BuildLegacyReviewPages}
  from "../src/lib/f3-legacy-intake-pages.ts";

/**
 * Local, offline developer/owner utility (NOT an API endpoint).
 *
 * Usage:
 * F3_LEGACY_HMAC_SECRET=<deployment-managed-value> npm run f3:offline-intake -- \
 *   --input <private-ace-extract.json> --output <hash-only-review-pages.json> \
 *   --organization-id <uuid>
 *
 * Never print input JSON, secret, row content or individual digests.
 */
const EXPECTED=new Set(["--input","--output","--organization-id"]);
function parseArguments(argv:readonly string[]){
  if(argv.length!==6)throw Error("f3_cli_requires_three_explicit_options");
  const options=new Map<string,string>();
  for(let i=0;i<argv.length;i+=2){
    const name=argv[i],value=argv[i+1];
    if(!EXPECTED.has(name)||!value||options.has(name))
      throw Error("f3_cli_unknown_duplicate_or_missing_option");
    options.set(name,value);
  }
  if(options.size!==3)throw Error("f3_cli_incomplete_arguments");
  return {input:resolve(options.get("--input")!),
    output:resolve(options.get("--output")!),
    organizationId:options.get("--organization-id")!};
}
function main(){
  const args=parseArguments(process.argv.slice(2));
  if(args.input===args.output ||
     existsSync(args.output))
    throw Error("f3_cli_output_must_be_new_separate_file");
  const info=statSync(args.input);
  if(!info.isFile()||info.size<2||info.size>64*1024*1024)
    throw Error("f3_cli_source_extraction_size_invalid");
  const value=JSON.parse(readFileSync(args.input,"utf8").replace(/^\uFEFF/,""));
  const pages=f3BuildLegacyReviewPages({
    organizationId:args.organizationId,
    extract:value,
    secret:process.env.F3_LEGACY_HMAC_SECRET??"",
  });
  const payload={
    format:"F3_REVIEW_ONLY_OFFLINE_ROW_LINEAGE_PAGES_V1",
    sourceLocalHashOnly:true,
    operationalReady:false,
    manifest:pages.manifest,
    pages:pages.pages,
  };
  // Exclusive creation and mode 0600 avoid overwriting source files and
  // world-readable HMAC evidence. The source extract stays private locally.
  const fd=openSync(args.output,"wx",0o600);
  try{
    writeFileSync(fd,JSON.stringify(payload)+"\n",{encoding:"utf8"});
  }finally{closeSync(fd);}
  process.stdout.write("F3_OFFLINE_HASHES_READY tables="+
    pages.manifest.tableCount+" rows="+pages.manifest.rowCount+
    " pages="+pages.pages.length+"; NO_REAL_SOURCE_APPROVAL\n");
}
try{main();}catch(error){
  process.stderr.write("F3_OFFLINE_INTAKE_FAILED "+(
    error instanceof Error&&/^f3_/.test(error.message)?
      error.message:"invalid_local_source_or_io")+"\n");
  process.exitCode=1;
}
