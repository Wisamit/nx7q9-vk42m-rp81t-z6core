import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { parseLegacyMasterCsv } from "../src/lib/legacy-master-data-import.ts";
import { createLegacyMasterRecords } from "../src/lib/legacy-master-import-commit.ts";

const samples = {
  REFERRER: "code,name_en,name_ar,type,phone,email,license_number\nPH_01,Dr Karim,د كريم,PHYSICIAN,0550000000,karim@example.com,DOH-1",
  SOURCE: "code,name_en,name_ar,category\nSRC_01,Walk In,مباشر,WALK_IN",
  ORGANISM: "code,name_en,name_ar,category\nORG_01,E coli,إشريكية قولونية,Gram negative",
  ANTIBIOTIC: "code,name_en,name_ar,drug_class\nAB_01,Amoxicillin,أموكسيسيلين,Penicillins",
} as const;

test("Stage 82: production create-only service maps four accepted master CSV shapes to correct models",async()=>{
  for(const kind of ["REFERRER","SOURCE","ORGANISM","ANTIBIOTIC"] as const){
    const record={...parseLegacyMasterCsv(kind,samples[kind])[0],id:randomUUID()};
    const calls:Array<{model:string;data:Record<string,unknown>[]}>= [];
    const fake=Object.fromEntries(["referrer","orderSource","organism","antibiotic"].map(name=>[
      name,{createMany:async({data}:{data:Record<string,unknown>[]})=>{
        calls.push({model:name,data});return {count:data.length};
      }},
    ]));
    await createLegacyMasterRecords(fake as never,kind,"TENANT-A",[record]);
    assert.equal(calls.length,1);
    const target={REFERRER:"referrer",SOURCE:"orderSource",ORGANISM:"organism",ANTIBIOTIC:"antibiotic"}[kind];
    assert.equal(calls[0].model,target);
    assert.equal(calls[0].data[0].id,record.id);
    assert.equal(calls[0].data[0].organizationId,"TENANT-A");
    assert.equal(calls[0].data[0].nameAr,record.nameAr);
    assert.equal(calls[0].data[0].code,record.code);
    if(kind==="REFERRER") {
      assert.equal(calls[0].data[0].type,"PHYSICIAN");
      assert.equal(calls[0].data[0].licenseNumber,"DOH-1");
    } else if(kind==="ANTIBIOTIC") assert.equal(calls[0].data[0].drugClass,"Penicillins");
    else assert.ok(calls[0].data[0].category);
  }
  await assert.rejects(()=>createLegacyMasterRecords({} as never,"INVALID" as never,"O",[]),
    /unsupported_master_kind/);
});
