import test from "node:test";
import assert from "node:assert/strict";
import {LEGACY_COVERAGE_SOURCES} from "../src/lib/legacy-source-coverage.ts";
import {legacyRowTargets} from "../src/lib/catalog-legacy-row-lineage.ts";
import {
  reconcileF3SemanticValues,type F3SemanticPolicy,type F3SemanticRow,
} from "../src/lib/f3-legacy-semantic-parity.ts";

const hash=(i:number)=>i.toString(16).padStart(64,"a").slice(0,64);
function fixture(){
  const policies:F3SemanticPolicy[]=LEGACY_COVERAGE_SOURCES.map((table,i)=>({
    tableName:table.tableName,
    targetType:legacyRowTargets[table.tableName][0],
    fields:[{sourceField:"LegacyValue",targetField:"CurrentValue",kind:
      i===4?"DECIMAL":i===2?"MEMBER_CODES":i===3?"INTEGER":
      i===12?"DATE":"TEXT" as const}],
  }));
  const values=policies.map(policy=>policy.fields[0].kind==="DECIMAL"?"99999.123400":
    policy.fields[0].kind==="INTEGER"?"000":policy.fields[0].kind==="DATE"?
    "2026-10-21":policy.fields[0].kind==="MEMBER_CODES"?["T.1","T-2"]:
    "Name clinical private example");
  // INTEGER must use canonical integer input with strict no-leading-zero grammar.
  const rows:F3SemanticRow[]=policies.map((policy,i)=>({
    tableName:policy.tableName,targetType:policy.targetType,
    rowDigest:hash(i+1),occurrence:1,classification:"APPROVED_MAPPING",
    source:{LegacyValue:policy.fields[0].kind==="INTEGER"?"0":values[i]},
    target:{CurrentValue:policy.fields[0].kind==="DECIMAL"?"99999.1234":
      policy.fields[0].kind==="MEMBER_CODES"?["t.1","t-2"]:
      policy.fields[0].kind==="INTEGER"?"0":values[i]},
  }));
  return {policies,rows};
}
test("F3: all fifteen allowlisted source families compare by explicitly typed synthetic values",()=>{
  const f=fixture(),out=reconcileF3SemanticValues(f);
  assert.equal(out.state,"SYNTHETIC_SEMANTIC_VALUES_MATCH");
  assert.equal(out.rows,15);assert.equal(out.matched,15);
  assert.equal(out.mismatched,0);assert.equal(out.tables.length,15);
  assert.equal(out.originalAccessFileVerified,false);
  assert.equal(out.databaseOriginAuthenticated,false);
  assert.equal(out.clinicalOrFinancialSignoff,false);
  assert.equal(out.importOrCutoverAuthorized,false);
  const text=JSON.stringify(out);
  for(const privateValue of ["99999.1234","Name clinical private example",
    f.rows[0].rowDigest,"T.1"])
    assert.equal(text.includes(privateValue),false);
});

test("F3: clinical and pricing mismatches are categorical, never raw values",()=>{
  const f=fixture();
  const values=f.rows.map((row,i)=>i===4?
    {...row,target:{CurrentValue:"99999.1235"}}:
    i===3?{...row,target:{CurrentValue:"1"}}:row);
  const out=reconcileF3SemanticValues({...f,rows:values});
  assert.equal(out.state,"SYNTHETIC_SEMANTIC_VALUE_GAPS");
  assert.equal(out.mismatched,2);assert.equal(out.matched,13);
  assert.deepEqual(out.tables.find(t=>t.tableName==="price")?.differingFields,
    ["CurrentValue"]);
  assert.deepEqual(out.tables.find(t=>t.tableName==="normal")?.differingFields,
    ["CurrentValue"]);
  assert.equal(JSON.stringify(out).includes("99999.1235"),false);
});

test("F3: one Access table may explicitly map different rows to different target types",()=>{
  const f=fixture();
  f.policies.push({tableName:"price",targetType:"PRICE_LIST_PACKAGE_ITEM",
    fields:[{sourceField:"Amount",targetField:"unitPrice",kind:"DECIMAL"}]});
  f.rows.push({tableName:"price",targetType:"PRICE_LIST_PACKAGE_ITEM",
    rowDigest:hash(40),occurrence:1,classification:"APPROVED_MAPPING",
    source:{Amount:"1.234500"},target:{unitPrice:"1.2345"}});
  const out=reconcileF3SemanticValues(f);
  assert.equal(out.rows,16);
  assert.equal(out.tables.filter(x=>x.tableName==="price").length,2);
  assert.equal(out.tables.find(x=>x.targetType==="PRICE_LIST_PACKAGE_ITEM")?.matched,1);
});

test("F3: reject unmapped/extra fields, numeric JS money, unapproved mapping and reused row identity",()=>{
  const f=fixture(),r=f.rows[0];
  const withFirst=(changed:Partial<F3SemanticRow>)=>
    reconcileF3SemanticValues({...f,rows:[{...r,...changed},...f.rows.slice(1)]});
  assert.throws(()=>withFirst({source:{LegacyValue:"x",PatientName:"PRIVATE"}}),
    /unapproved_or_missing_field/);
  assert.throws(()=>withFirst({target:{}}),/unapproved_or_missing_field/);
  assert.throws(()=>withFirst({classification:"MAPPED" as never}),
    /not_approved_or_invalid/);
  assert.throws(()=>withFirst({rowDigest:"untrusted"}),/not_approved_or_invalid/);
  assert.throws(()=>withFirst({targetType:"CONTRACT"}),/not_approved_or_invalid/);
  assert.throws(()=>reconcileF3SemanticValues({...f,rows:[...f.rows,r]}),
    /duplicate_source_identity/);
  const amount=f.rows[4];
  assert.throws(()=>reconcileF3SemanticValues({...f,
    rows:f.rows.map((row,i)=>i===4?{...amount,target:{CurrentValue:99999.1234}}:row),
  }),/invalid_typed_value/);
  assert.throws(()=>reconcileF3SemanticValues({...f,
    rows:f.rows.map((row,i)=>i===4?{...amount,target:{CurrentValue:"Infinity"}}:row),
  }),/invalid_typed_value/);
  assert.throws(()=>reconcileF3SemanticValues({...f,
    policies:[...f.policies,f.policies[0]],
  }),/policy_invalid/);
  assert.throws(()=>reconcileF3SemanticValues({...f,
    policies:f.policies.map((x,i)=>i===0?{...x,
      fields:[...x.fields,{sourceField:"LegacyValue",targetField:"Other",kind:"TEXT"}]}:x),
  }),/policy_fields_invalid/);
});

test("F3: normalized membership, case-sensitive names and date validity never mask real mismatches",()=>{
  const f=fixture();
  const changes=f.rows.map((row,i)=>i===2?{
    ...row,target:{CurrentValue:["T.1","T.1"]},
  }:row);
  assert.throws(()=>reconcileF3SemanticValues({...f,rows:changes}),
    /invalid_typed_value/);
  const nameRow=f.rows[0];
  const wrong=[{...nameRow,target:{CurrentValue:"name clinical private example"}},
    ...f.rows.slice(1)];
  assert.equal(reconcileF3SemanticValues({...f,rows:wrong}).mismatched,1);
  const dates=f.rows.map((row,i)=>i===12?{...row,target:{CurrentValue:"2026-02-30"}}:row);
  assert.throws(()=>reconcileF3SemanticValues({...f,rows:dates}),/invalid_typed_value/);
});


test("F8 §88: reordered Access profile tests must be reported as semantic migration drift",()=>{
  const original=fixture();
  const reversed=original.rows.map((row,i)=>i===2?
    {...row,target:{CurrentValue:["t-2","t.1"]}}:row);
  const report=reconcileF3SemanticValues({...original,rows:reversed});
  assert.equal(report.state,"SYNTHETIC_SEMANTIC_VALUE_GAPS");
  assert.equal(report.mismatched,1);
  const table=report.tables.find(x=>x.tableName===original.rows[2].tableName);
  assert.deepEqual(table?.differingFields,["CurrentValue"]);
  assert.equal(report.originalAccessFileVerified,false);
  assert.equal(report.clinicalOrFinancialSignoff,false);
  assert.equal(report.importOrCutoverAuthorized,false);
  assert.equal(JSON.stringify(report).includes("t-2"),false);
  assert.equal(JSON.stringify(report).includes(original.rows[2].rowDigest),false);
});

test("F8 §88: case-only changes remain equivalent without hiding changes to ordered membership",()=>{
  const original=fixture();
  const matching=original.rows.map((row,i)=>i===2?
    {...row,target:{CurrentValue:["t.1","T-2"]}}:row);
  const report=reconcileF3SemanticValues({...original,rows:matching});
  assert.equal(report.mismatched,0);
  for(const values of [["t.1"],["t.1","OTHER"],["t.1","T-2","OTHER"]]){
    const wrong=original.rows.map((row,i)=>i===2?
      {...row,target:{CurrentValue:values}}:row);
    assert.equal(reconcileF3SemanticValues({...original,rows:wrong}).mismatched,1);
  }
});

test("F8 §88: deliberately unordered membership requires an explicit typed parity policy",()=>{
  const original=fixture();
  const optedPolicy=original.policies.map((policy,i)=>i===2?
    {...policy,fields:[{...policy.fields[0],kind:"UNORDERED_MEMBER_CODES" as const}]}:
    policy);
  const reordered=original.rows.map((row,i)=>i===2?
    {...row,target:{CurrentValue:["t-2","t.1"]}}:row);
  const report=reconcileF3SemanticValues({policies:optedPolicy,rows:reordered});
  assert.equal(report.mismatched,0);
  assert.equal(report.originalAccessFileVerified,false);
  assert.equal(report.clinicalOrFinancialSignoff,false);
  assert.equal(report.importOrCutoverAuthorized,false);
  // Even opt-in unordered matching must reject repeated members and
  // preserve actual membership: neither a duplicated nor omitted test is safe.
  const duplicates=reordered.map((row,i)=>i===2?
    {...row,target:{CurrentValue:["t-2","t-2"]}}:row);
  assert.throws(()=>reconcileF3SemanticValues({policies:optedPolicy,rows:duplicates}),
    /invalid_typed_value/);
  const missing=reordered.map((row,i)=>i===2?
    {...row,target:{CurrentValue:["t-2"]}}:row);
  assert.equal(reconcileF3SemanticValues({policies:optedPolicy,rows:missing}).mismatched,1);
});

test("F8 §88: an unapproved or misspelled comparison kind cannot bypass ordered checking",()=>{
  const original=fixture();
  const policy=original.policies.map((p,i)=>i===2?
    {...p,fields:[{...p.fields[0],kind:"MEMBERS_AUTO" as never}]}:p);
  assert.throws(()=>reconcileF3SemanticValues({policies:policy,rows:original.rows}),
    /policy_fields_invalid/);
});
