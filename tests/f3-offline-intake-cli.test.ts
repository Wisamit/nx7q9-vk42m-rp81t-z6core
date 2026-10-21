import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync,writeFileSync,readFileSync,statSync,
  existsSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LEGACY_COVERAGE_SOURCES} from "../src/lib/legacy-source-coverage.ts";

const org="00000000-0000-4000-8000-000000000001";
const source=()=>({
  format:"F3_ACE_OFFLINE_CONFIGURATION_EXTRACT_V1",
  sourceName:"Synthetic legacy.mdb",sourceSha256:"a".repeat(64),
  sourceBytes:123456,exportedAtUtc:"2026-10-21T12:00:00.000Z",
  sourceFileBytesHashedLocally:true,
  sourceIdentityExternallyAttested:false,migrated:false,
  tables:LEGACY_COVERAGE_SOURCES.map(({tableName})=>({
    name:tableName,
    columns:[{name:"TestName",accessType:"ACE_TYPE_202"}],
    rows:tableName==="test"?[{TestName:"Synthetic sensitive test label"}]:[],
  })),
});
test("F3: executable CLI emits only HMAC fingerprints to new 0600 file without leaking source rows",()=>{
  const dir=mkdtempSync(join(tmpdir(),"f3-offline-"));
  const input=join(dir,"raw-offline.json"),output=join(dir,"private-hashes.json");
  try{
    writeFileSync(input,"\uFEFF"+JSON.stringify(source()));
    const cmd=spawnSync(process.execPath,[
      "--experimental-strip-types","scripts/f3-offline-intake.ts",
      "--input",input,"--output",output,
      "--organization-id",org,
    ],{cwd:process.cwd(),encoding:"utf8",
      env:{...process.env,F3_LEGACY_HMAC_SECRET:
        "synthetic-F3-CLI-HMAC-secret-never-deploy-1234567890"}});
    assert.equal(cmd.status,0,cmd.stderr);
    assert.equal(existsSync(output),true);
    assert.equal(statSync(output).mode&0o777,0o600);
    const content=readFileSync(output,"utf8");
    const parsed=JSON.parse(content);
    assert.equal(parsed.manifest.rowCount,1);
    assert.equal(parsed.manifest.tableCount,15);
    assert.equal(parsed.pages.length,15);
    assert.equal(parsed.operationalReady,false);
    assert.equal(parsed.pages.filter((x:{rows:unknown[]})=>x.rows.length).length,1);
    for(const text of ["Synthetic sensitive test label","raw-offline.json",
      "synthetic-F3-CLI-HMAC-secret-never-deploy"])
      assert.equal(content.includes(text),false);
    assert.equal(cmd.stdout.includes("Synthetic sensitive test label"),false);
    // Never overwrite either the raw extraction or a prior successful proof.
    const repeat=spawnSync(process.execPath,[
      "--experimental-strip-types","scripts/f3-offline-intake.ts",
      "--input",input,"--output",output,"--organization-id",org,
    ],{cwd:process.cwd(),encoding:"utf8",env:{
      ...process.env,F3_LEGACY_HMAC_SECRET:
        "synthetic-F3-CLI-HMAC-secret-never-deploy-1234567890",
    }});
    assert.notEqual(repeat.status,0);
    assert.match(repeat.stderr,/f3_cli_output_must_be_new_separate_file/);
    assert.deepEqual(readFileSync(output),Buffer.from(content));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test("F3: CLI fails closed if HMAC secret is missing or source claims an operational approval",()=>{
  const dir=mkdtempSync(join(tmpdir(),"f3-offline-negative-"));
  const input=join(dir,"source.json");
  const run=(output:string,secret:string|undefined)=>{
    const env={...process.env};
    if(secret===undefined)delete env.F3_LEGACY_HMAC_SECRET;
    else env.F3_LEGACY_HMAC_SECRET=secret;
    return spawnSync(process.execPath,[
      "--experimental-strip-types","scripts/f3-offline-intake.ts",
      "--input",input,"--output",output,"--organization-id",org,
    ],{cwd:process.cwd(),encoding:"utf8",env});
  };
  try{
    writeFileSync(input,JSON.stringify(source()));
    const noSecret=run(join(dir,"no-secret.json"),undefined);
    assert.notEqual(noSecret.status,0);
    assert.equal(existsSync(join(dir,"no-secret.json")),false);
    writeFileSync(input,JSON.stringify({...source(),
      sourceIdentityExternallyAttested:true}));
    const fraudulent=run(join(dir,"fraudulent.json"),
      "valid-synthetic-f3-CLI-test-key-12345678901234");
    assert.notEqual(fraudulent.status,0);
    assert.equal(existsSync(join(dir,"fraudulent.json")),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
