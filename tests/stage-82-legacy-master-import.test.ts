import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEGACY_MASTER_COLUMNS, LEGACY_MASTER_MAX_BYTES, LEGACY_MASTER_MAX_ROWS,
  LegacyMasterImportError, legacyMasterFingerprint, parseLegacyMasterCsv,
  type LegacyMasterKind,
} from "../src/lib/legacy-master-data-import.ts";

test("Stage 82: bilingual RFC4180 CSV including quoted commas, escaped quotes, CRLF and BOM",()=>{
  const data='\uFEFFcode,name_en,name_ar,type,phone,email,license_number\r\n'+
    'DR_1,"Dr. Smith, Jane","الدكتورة ""سارة""",PHYSICIAN,+971500001111,JANE@Example.com,L-123\r\n'+
    'CLINIC2,Community Clinic,عيادة المجتمع,CLINIC,,,';
  const parsed=parseLegacyMasterCsv("REFERRER",data);
  assert.equal(parsed.length,2);
  assert.deepEqual(parsed.map(x=>x.code),["DR_1","CLINIC2"]);
  assert.equal(parsed[0].nameEn,"Dr. Smith, Jane");
  assert.equal(parsed[0].nameAr,'الدكتورة "سارة"');
  assert.equal(parsed[0].type,"PHYSICIAN");
  assert.equal(parsed[0].email,"jane@example.com");
  assert.equal(parsed[0].rowNumber,2);
  assert.equal(parsed[1].type,"CLINIC");
});

test("Stage 82: all four master kinds preserve explicit clinical/commercial class mappings",()=>{
  for(const [kind,header,row,detail] of [
    ["SOURCE","code,name_en,name_ar,category","REF_HOME,Home collection,سحب منزلي,HOME_COLLECTION","HOME_COLLECTION"],
    ["ORGANISM","code,name_en,name_ar,category","ECOLI,Escherichia coli,إشريكية قولونية,Gram negative","Gram negative"],
    ["ANTIBIOTIC","code,name_en,name_ar,drug_class","AMOX,Amoxicillin,أموكسيسيلين,Penicillins","Penicillins"],
  ] as Array<[LegacyMasterKind,string,string,string]>){
    assert.deepEqual(LEGACY_MASTER_COLUMNS[kind].join(","),header);
    const result=parseLegacyMasterCsv(kind,header+"\n"+row)[0];
    assert.equal(result.rowNumber,2);
    assert.equal(result.nameAr!==null,true);
    if(kind==="ANTIBIOTIC")assert.equal(result.drugClass,detail);
    else assert.equal(result.category,detail);
  }
});

test("Stage 82: malformed, oversized, duplicate, invalid classification and unexpected header fail closed",()=>{
  const bad:Array<[LegacyMasterKind,string,string]> = [
    ["REFERRER","code,name_en,name_ar,type,phone,email,license_number\nR1,Test,,UNKNOWN,,,","invalid_referrer_type_row_2"],
    ["REFERRER","code,name_en,name_ar,type,phone,email,license_number\nR1,Test,,PHYSICIAN,,bad-email,","invalid_email_row_2"],
    ["SOURCE","code,name_en,name_ar,category\nS1,Source,,","source_category_required_row_2"],
    ["SOURCE","code,name_en,name_ar,category\nS1,A,,OTHER\ns1,B,,OTHER","duplicate_code_in_csv_row_3"],
    ["ORGANISM","code,name_en,name_ar,category\nA,X,,z\nA,Y,,y","duplicate_code_in_csv_row_3"],
    ["ANTIBIOTIC","code,name_en,name_ar,drug_class\nbad code,Medicine,,Class","invalid_code_row_2"],
    ["SOURCE","name_en,code,name_ar,category\nA,B,,C","header_mismatch"],
    ["SOURCE","code,name_en,name_ar,category\nS1,A,,B,EXTRA","column_count_mismatch_row_2"],
    ["SOURCE",'code,name_en,name_ar,category\nS1,"broken,,CLASS',"unterminated_csv_quote"],
    ["REFERRER","code,name_en,name_ar,type,phone,email,license_number\nR1,Name,,PHYSICIAN,,,\nR2,Name,,PHYSICIAN,,","column_count_mismatch_row_3"],
  ];
  for(const [kind,csv,expected] of bad) {
    assert.throws(()=>parseLegacyMasterCsv(kind,csv),e=>
      e instanceof LegacyMasterImportError && e.reason===expected,kind+":"+expected);
  }
  assert.throws(()=>parseLegacyMasterCsv("SOURCE","code,name_en,name_ar,category"),
    {reason:"no_import_rows"});
  assert.throws(()=>parseLegacyMasterCsv("SOURCE",
    "code,name_en,name_ar,category\n"+("S1,A,,X\n".repeat(LEGACY_MASTER_MAX_ROWS+1))),
    {reason:"too_many_rows"});
  assert.throws(()=>parseLegacyMasterCsv("SOURCE",
    "code,name_en,name_ar,category\n"+"S1,"+"x".repeat(LEGACY_MASTER_MAX_BYTES)+",,X"),
    {reason:"csv_too_large"});
});

test("Stage 82: normalized tenant+kind+rows fingerprint binds exact approved set",()=>{
  const rows=parseLegacyMasterCsv("SOURCE","code,name_en,name_ar,category\nA,Clinic,عيادة,CLINIC");
  const fingerprint=legacyMasterFingerprint("ORG_A","SOURCE",rows);
  assert.match(fingerprint,/^[0-9a-f]{64}$/);
  assert.notEqual(fingerprint,legacyMasterFingerprint("ORG_B","SOURCE",rows));
  assert.notEqual(fingerprint,legacyMasterFingerprint("ORG_A","ORGANISM",rows));
  assert.notEqual(fingerprint,legacyMasterFingerprint("ORG_A","SOURCE",[{...rows[0],nameEn:"Changed"}]));
});

test("Stage 82: preview is read only, APPLY requires same fingerprint and explicit consent, all writes audited inside transaction",()=>{
  const route=readFileSync("src/app/api/legacy/master-data-import/route.ts","utf8");
  const commit=readFileSync("src/lib/legacy-master-import-commit.ts","utf8");
  const ui=readFileSync("src/components/legacy-master-data-import.tsx","utf8");
  const page=readFileSync("src/app/catalog/legacy-master-data/page.tsx","utf8");
  assert.match(route,/requirePermission\("catalog\.manage"\)/);
  assert.match(route,/permissions\.has\(allowed\[kind\]\)/);
  assert.match(route,/active_branch_scope_required/);
  assert.match(route,/if \(mode === "PREVIEW"\)/);
  assert.ok(route.indexOf('if (mode === "PREVIEW")') < route.indexOf('await prisma.$transaction'));
  assert.match(route,/CREATE_NEW_RECORDS_ONLY/);
  assert.match(route,/input\.expectedFingerprint !== fingerprint/);
  assert.match(route,/if \(collisionsSet\.size > 0\)/);
  assert.match(route,/existingCodes\(tx, kind, organizationId, codes\)/);
  assert.match(route,/await createLegacyMasterRecords\(tx, kind, organizationId, entries\)/);
  assert.match(route,/action: "LEGACY_MASTER_RECORD_CREATED"/);
  assert.match(route,/action: "LEGACY_MASTER_DATA_IMPORT_COMMITTED"/);
  assert.match(route,/isolationLevel: "Serializable"/);
  assert.match(commit,/\.createMany\(/);
  assert.doesNotMatch(commit,/skipDuplicates:\s*true/);
  assert.doesNotMatch(commit,/\.update\(/);
  assert.match(ui,/2\. Approve and create records/);
  assert.match(page,/requirePermission\("catalog\.manage"\)/);
  assert.match(page,/permissions|permissionSet/);
});
