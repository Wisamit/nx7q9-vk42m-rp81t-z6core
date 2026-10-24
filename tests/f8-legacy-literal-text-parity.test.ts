import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_COVERAGE_SOURCES } from "../src/lib/legacy-source-coverage.ts";
import { legacyRowTargets } from "../src/lib/catalog-legacy-row-lineage.ts";
import { reconcileF3SemanticValues, type F3SemanticKind } from "../src/lib/f3-legacy-semantic-parity.ts";

const tableName=LEGACY_COVERAGE_SOURCES[0].tableName;
const targetType=legacyRowTargets[tableName][0];
const h="d".repeat(64);
function check(kind:F3SemanticKind,before:string,after:string) {
  return reconcileF3SemanticValues({
    policies:[{tableName,targetType,fields:[
      {sourceField:"LegacyReportText",targetField:"ReportText",kind}
    ]}],
    rows:[{
      tableName,targetType,rowDigest:h,occurrence:1,
      classification:"APPROVED_MAPPING",
      source:{LegacyReportText:before},
      target:{ReportText:after},
    }],
  });
}
test("F8 §88: literal TEXT detects leading/trailing spaces, tabs, line breaks and delimiter drift",()=>{
  const source="  Accepted \t\nResult: 5.200 ";
  for(const changed of [
    source.trim(),source.replace("  Accepted","Accepted"),
    source.replace("\t",""),source.replace("\n"," "),
    source.replace("5.200","5.20"),source+" ",
  ]) {
    const result=check("TEXT",source,changed);
    assert.equal(result.mismatched,1);
    assert.equal(result.matched,0);
    assert.deepEqual(result.tables[0].differingFields,["ReportText"]);
    assert.equal(result.originalAccessFileVerified,false);
    assert.equal(result.clinicalOrFinancialSignoff,false);
    assert.equal(result.importOrCutoverAuthorized,false);
    const report=JSON.stringify(result);
    assert.ok(!report.includes(source)&&!report.includes(changed)&&!report.includes(h));
  }
  assert.equal(check("TEXT",source,source).mismatched,0);
});
test("F8 §88: literal TEXT exposes composed/decomposed Unicode differences, including Arabic marks",()=>{
  assert.equal(check("TEXT","e\u0301","\u00e9").mismatched,1);
  assert.equal(check("TEXT","ا\u0654","\u0623").mismatched,1);
  assert.equal(check("TEXT_NORMALIZED","e\u0301","\u00e9").mismatched,0);
  assert.equal(check("TEXT_NORMALIZED","ا\u0654","\u0623").mismatched,0);
});
test("F8 §88: TEXT_CASEFOLD opts into case equivalence only, never silent whitespace loss",()=>{
  assert.equal(check("TEXT_CASEFOLD","HbA1C","hba1c").mismatched,0);
  assert.equal(check("TEXT_CASEFOLD"," HbA1C","hba1c").mismatched,1);
  assert.equal(check("TEXT_CASEFOLD","e\u0301","\u00e9").mismatched,1);
});
test("F8 §88: explicit normalized modes retain deliberately approved legacy compatibility",()=>{
  assert.equal(check("TEXT_NORMALIZED","  Report \t","Report").mismatched,0);
  assert.equal(check("TEXT_CASEFOLD_NORMALIZED","  HbA1C  ","hba1c").mismatched,0);
  assert.equal(check("TEXT_NORMALIZED","Report","report").mismatched,1);
});
test("F8 §88: undocumented text comparison schemes reject before evaluation",()=>{
  const invalid="AUTO_TEXT_COLLATION" as F3SemanticKind;
  assert.throws(()=>check(invalid,"x","x"),/policy_fields_invalid/);
  assert.throws(()=>check("TEXT","x".repeat(10001),"x".repeat(10001)),
    /invalid_typed_value/);
  const number=JSON.parse(JSON.stringify({
    policies:[{tableName,targetType,fields:[
      {sourceField:"LegacyReportText",targetField:"ReportText",kind:"TEXT"}
    ]}],
    rows:[{tableName,targetType,rowDigest:h,occurrence:1,
      classification:"APPROVED_MAPPING",source:{LegacyReportText:5},target:{ReportText:"5"}}],
  }));
  assert.throws(()=>reconcileF3SemanticValues(number),/invalid_typed_value/);
});
