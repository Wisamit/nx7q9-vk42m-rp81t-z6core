import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { legacyMasterFingerprint, parseLegacyMasterCsv, LegacyMasterImportError,
  LEGACY_MASTER_COLUMNS } from "../src/lib/legacy-master-data-import.ts";
import { resolveLegacyCommentTargets } from "../src/lib/legacy-comment-targets.ts";
import { createLegacyMasterRecords } from "../src/lib/legacy-master-import-commit.ts";

const header = "code,name_en,name_ar,text_en,text_ar,scope,test_code,component_code";
const sample = header + "\n"+
  'ORG_C,\"Clinical, note\",ملاحظة,\"First line\nSecond line\",وصف,ORGANIZATION,,\n'+
  'TEST_C,Test note,نص الاختبار,Verified text,نص مثبت,TEST,CBC,\n'+
  'COMP_C,Component note,ملاحظة مكون,Second message,نص ثاني,COMPONENT,CBC,HGB';

test("Stage 84: exact bilingual CSV and explicit clinical target scopes", () => {
  assert.equal(LEGACY_MASTER_COLUMNS.COMMENT_TEMPLATE.join(","), header);
  const rows = parseLegacyMasterCsv("COMMENT_TEMPLATE", "\uFEFF" + sample);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].nameEn, "Clinical, note");
  assert.equal(rows[0].textEn, "First line\nSecond line");
  assert.equal(rows[0].textAr, "وصف");
  assert.equal(rows[1].testCode, "CBC");
  assert.equal(rows[2].componentCode, "HGB");
  assert.notEqual(legacyMasterFingerprint("A", "COMMENT_TEMPLATE", rows),
    legacyMasterFingerprint("B", "COMMENT_TEMPLATE", rows));
  assert.notEqual(legacyMasterFingerprint("A", "COMMENT_TEMPLATE", rows),
    legacyMasterFingerprint("A", "COMMENT_TEMPLATE",
      parseLegacyMasterCsv("COMMENT_TEMPLATE",sample.replace("Verified text","Changed"))));
});

test("Stage 84: no guessed test/component, empty or oversized clinical text, duplicate codes or malformed quote", () => {
  const bad: Array<[string, string]> = [
    ["X,Name,,Text,,WRONG,,","invalid_comment_scope_row_2"],
    ["X,Name,,Text,,TEST,,","invalid_comment_target_row_2"],
    ["X,Name,,Text,,ORGANIZATION,CBC,","invalid_comment_target_row_2"],
    ["X,Name,,Text,,TEST,CBC,HGB","invalid_comment_target_row_2"],
    ["X,Name,,Text,,COMPONENT,CBC,","invalid_comment_target_row_2"],
    ["X,Name,,,,ORGANIZATION,,","invalid_comment_text_row_2"],
    ["X,Name,,\"Unclosed,,ORGANIZATION,,","unterminated_csv_quote"],
    ["X,Name,,Text,,TEST,CBC,\nx,Other,,Text,,TEST,CBC,","duplicate_code_in_csv_row_3"],
  ];
  for (const [row, reason] of bad) {
    assert.throws(() => parseLegacyMasterCsv("COMMENT_TEMPLATE",header+"\n"+row),
      (error:unknown) => error instanceof LegacyMasterImportError && error.reason===reason,reason);
  }
  assert.throws(()=>parseLegacyMasterCsv("COMMENT_TEMPLATE",header+"\nX,Name,,"+"x".repeat(5001)+",,ORGANIZATION,,"),
    /invalid_comment_text_row_2/);
});

test("Stage 84: organization-bound ACTIVE test and component resolution, without inferred mapping",async()=>{
  const records = parseLegacyMasterCsv("COMMENT_TEMPLATE",sample);
  const db = {labTest:{findMany: async(args:{where:{organizationId:string;code:{in:string[]};status:string}})=>{
    assert.equal(args.where.organizationId,"ORG84");
    assert.equal(args.where.status,"ACTIVE");
    assert.deepEqual(args.where.code.in,["CBC"]);
    return [{id:"T84",code:"CBC",components:[{id:"C84",code:"HGB"}]}];
  }}};
  assert.deepEqual(await resolveLegacyCommentTargets(db as never,"ORG84",records),
    [{testId:null,componentId:null},{testId:"T84",componentId:null},{testId:"T84",componentId:"C84"}]);
  await assert.rejects(resolveLegacyCommentTargets({labTest:{findMany:async()=>[]}} as never,"OTHER",records),
    /comment_test_missing_or_inactive_row_3/);
  await assert.rejects(resolveLegacyCommentTargets({labTest:{findMany:async()=>[
    {id:"T84",code:"CBC",components:[]}
  ]}} as never,"ORG84",records),/comment_component_missing_or_inactive_row_4/);
});

test("Stage 84: committed templates are all INACTIVE, correctly targeted, audited by the route, and no clinical result/report writes",async()=>{
  const rows = parseLegacyMasterCsv("COMMENT_TEMPLATE",sample).map(row=>({...row,id:randomUUID()}));
  const inserted:Array<Record<string,unknown>> = [];
  const tx = {
    labTest:{findMany:async()=>[{id:"T84",code:"CBC",components:[{id:"C84",code:"HGB"}]}]},
    resultCommentTemplate:{createMany:async({data}:{data:Array<Record<string,unknown>>})=>{
      inserted.push(...data);return {count:data.length};
    }},
  };
  await createLegacyMasterRecords(tx as never,"COMMENT_TEMPLATE","ORG84",rows);
  assert.equal(inserted.length,3);
  assert.deepEqual(inserted.map(x=>[x.scope,x.testId,x.componentId]),[
    ["ORGANIZATION",null,null],["TEST","T84",null],["COMPONENT","T84","C84"]]);
  assert.ok(inserted.every(x=>x.status==="INACTIVE" && x.deactivatedAt instanceof Date));
  assert.ok(inserted.every(x=>x.organizationId==="ORG84"));
  const route = readFileSync("src/app/api/legacy/master-data-import/route.ts","utf8");
  const ui = readFileSync("src/components/legacy-master-data-import.tsx","utf8");
  const page = readFileSync("src/app/catalog/legacy-master-data/page.tsx","utf8");
  assert.match(route,/COMMENT_TEMPLATE: "result_comments.manage"/);
  assert.match(route,/CREATE_INACTIVE_COMMENT_TEMPLATES_ONLY/);
  assert.match(route,/resolveLegacyCommentTargets\(prisma, organizationId, rows\)/);
  assert.match(route,/existingCodes\(tx, kind, organizationId, codes\)/);
  assert.match(route,/isolationLevel: "Serializable"/);
  assert.match(page,/grants\.has\("result_comments.manage"\)/);
  assert.match(ui,/row\.textEn/);
  assert.match(ui,/CREATE_INACTIVE_COMMENT_TEMPLATES_ONLY/);
  const writer = readFileSync("src/lib/legacy-master-import-commit.ts","utf8");
  assert.doesNotMatch(writer,/tx\.laboratoryResult\.update/);
  assert.doesNotMatch(writer,/tx\.diagnosticReport\.update/);
  assert.doesNotMatch(writer,/tx\.resultCommentTemplate\.update/);
});
