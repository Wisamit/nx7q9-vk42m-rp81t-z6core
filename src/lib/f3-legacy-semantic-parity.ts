import {
  LEGACY_COVERAGE_SOURCES,
} from "./legacy-source-coverage.ts";
import {
  legacyRowHex,legacyRowTargets,
} from "./catalog-legacy-row-lineage.ts";

/** Workstation-only normalized values. NEVER submit these to a LIS HTTP API. */
export type F3SemanticKind =
  "TEXT"|"TEXT_CASEFOLD"|"INTEGER"|"DECIMAL"|"BOOLEAN"|"DATE"|"MEMBER_CODES";
export type F3SemanticField={
  sourceField:string;targetField:string;kind:F3SemanticKind;
};
export type F3SemanticPolicy={
  tableName:string;targetType:string;fields:readonly F3SemanticField[];
};
export type F3SemanticRow={
  tableName:string;rowDigest:string;occurrence:number;
  classification:"APPROVED_MAPPING";
  targetType:string;
  source:Readonly<Record<string,unknown>>;
  target:Readonly<Record<string,unknown>>;
};
export type F3SemanticTableResult={
  tableName:string;targetType:string;rows:number;matched:number;mismatched:number;
  differingFields:readonly string[];
};
export type F3SemanticParityResult={
  state:"SYNTHETIC_SEMANTIC_VALUES_MATCH"|"SYNTHETIC_SEMANTIC_VALUE_GAPS";
  rows:number;matched:number;mismatched:number;
  tables:readonly F3SemanticTableResult[];
  originalAccessFileVerified:false;databaseOriginAuthenticated:false;
  clinicalOrFinancialSignoff:false;importOrCutoverAuthorized:false;
};

const own=(v:unknown):v is Record<string,unknown>=>
  v!==null&&typeof v==="object"&&!Array.isArray(v);
const fieldsMatch=(v:Record<string,unknown>,keys:readonly string[])=>
  Object.keys(v).sort().join("\0")===[...keys].sort().join("\0");
const sourceTables=new Set<string>(LEGACY_COVERAGE_SOURCES.map(x=>x.tableName));
const numeric=/^[+-]?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const shortName=/^[a-zA-Z][a-zA-Z0-9_]{0,79}$/;
const testCode=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
function normalized(kind:F3SemanticKind,value:unknown):string|null{
  if(value===null)return "NULL";
  switch(kind){
    case "TEXT":
    case "TEXT_CASEFOLD": {
      if(typeof value!=="string"||value.length>10000)return null;
      const clean=value.normalize("NFC").trim();
      return "TEXT:"+ (kind==="TEXT_CASEFOLD"?clean.toLocaleLowerCase("en-US"):clean);
    }
    case "INTEGER": {
      if(typeof value!=="string"||!/^[+-]?(?:0|[1-9]\d{0,14})$/.test(value))
        return null;
      return "INTEGER:"+BigInt(value).toString();
    }
    case "DECIMAL": {
      // Never use Number: exact monetary/critical digits must be preserved.
      if(typeof value!=="string"||value.length>64||!numeric.test(value))
        return null;
      let v=value.replace(/^\+/,"");
      let sign="";
      if(v.startsWith("-")){sign="-";v=v.slice(1);}
      let [whole,fraction=""]=v.split(".");
      whole=whole.replace(/^0+(?=\d)/,"");
      fraction=fraction.replace(/0+$/,"");
      if(whole==="0"&&!fraction)sign="";
      return "DECIMAL:"+sign+whole+(fraction?"."+fraction:"");
    }
    case "BOOLEAN":
      if(typeof value!=="boolean")return null;
      return "BOOLEAN:"+(value?"1":"0");
    case "DATE":
      if(typeof value!=="string"||
         !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
         !Number.isFinite(Date.parse(value+"T00:00:00.000Z")) ||
         new Date(value+"T00:00:00.000Z").toISOString().slice(0,10)!==value)
        return null;
      return "DATE:"+value;
    case "MEMBER_CODES": {
      if(!Array.isArray(value)||value.length>10000)return null;
      const members:string[]=[];
      for(const member of value){
        if(typeof member!=="string"||!testCode.test(member))return null;
        members.push(member.toUpperCase());
      }
      if(new Set(members).size!==members.length)return null;
      return "MEMBERS:"+members.sort().join("|");
    }
    default:return null;
  }
}
function validatedPolicies(policies:readonly F3SemanticPolicy[]){
  const map=new Map<string,F3SemanticPolicy>();
  if(policies.length<1||policies.length>48)throw Error("f3_semantic_policy_count_invalid");
  for(const policy of policies){
    if(!sourceTables.has(policy.tableName)||
       !legacyRowTargets[policy.tableName]?.includes(policy.targetType)||
       !Array.isArray(policy.fields)||policy.fields.length<1||
       policy.fields.length>64||
       map.has(policy.tableName+":"+policy.targetType))throw Error("f3_semantic_policy_invalid");
    const sources=new Set<string>(),targets=new Set<string>();
    for(const field of policy.fields){
      if(!shortName.test(field.sourceField)||
         !shortName.test(field.targetField)||
         !["TEXT","TEXT_CASEFOLD","INTEGER","DECIMAL","BOOLEAN",
           "DATE","MEMBER_CODES"].includes(field.kind)||
         sources.has(field.sourceField)||targets.has(field.targetField))
        throw Error("f3_semantic_policy_fields_invalid");
      sources.add(field.sourceField);targets.add(field.targetField);
    }
    map.set(policy.tableName+":"+policy.targetType,policy);
  }
  return map;
}
/**
 * Private in-memory semantic comparison of mapped source/target values.
 * Both objects must exactly match the explicit field contract. Never infer
 * medical or tariff mappings, skip extra columns, or silently coerce Number.
 * Policy is supplied by a trusted local configuration, not from imported
 * patient values. Return only aggregate differences, never source values,
 * UUIDs, row HMACs or field-level patient information.
 */
export function reconcileF3SemanticValues(input:{
  policies:readonly F3SemanticPolicy[];rows:readonly F3SemanticRow[];
}):F3SemanticParityResult{
  const policies=validatedPolicies(input.policies);
  if(input.rows.length<1||input.rows.length>3_000_000)
    throw Error("f3_semantic_row_count_invalid");
  const seen=new Set<string>();
  const totals=new Map<string,{
    rows:number;matched:number;mismatched:number;fields:Set<string>;
  }>();
  for(const row of input.rows){
    const policy=policies.get(row.tableName+":"+row.targetType);
    if(!policy||row.targetType!==policy.targetType||
       row.classification!=="APPROVED_MAPPING"||
       !legacyRowHex.test(row.rowDigest)||
       !Number.isSafeInteger(row.occurrence)||row.occurrence<1||
       row.occurrence>10_000_000||!own(row.source)||!own(row.target))
      throw Error("f3_semantic_row_not_approved_or_invalid");
    const key=JSON.stringify([row.tableName,row.rowDigest,row.occurrence]);
    if(seen.has(key))throw Error("f3_semantic_duplicate_source_identity");
    seen.add(key);
    if(!fieldsMatch(row.source,policy.fields.map(x=>x.sourceField)) ||
       !fieldsMatch(row.target,policy.fields.map(x=>x.targetField)))
      throw Error("f3_semantic_unapproved_or_missing_field");
    const summary=totals.get(row.tableName+":"+row.targetType)||
      {rows:0,matched:0,mismatched:0,fields:new Set<string>()};
    let mismatch=false;
    for(const f of policy.fields){
      const before=normalized(f.kind,row.source[f.sourceField]);
      const after=normalized(f.kind,row.target[f.targetField]);
      if(before===null||after===null)
        throw Error("f3_semantic_invalid_typed_value");
      if(before!==after){mismatch=true;summary.fields.add(f.targetField);}
    }
    summary.rows++;
    if(mismatch)summary.mismatched++;else summary.matched++;
    totals.set(row.tableName+":"+row.targetType,summary);
  }
  const tables=[...policies].map(([name])=>{
    const v=totals.get(name);
    return {tableName:name,rows:v?.rows||0,matched:v?.matched||0,
      mismatched:v?.mismatched||0,
      differingFields:[...(v?.fields||[])].sort()};
  });
  const matched=tables.reduce((a,x)=>a+x.matched,0);
  const mismatched=tables.reduce((a,x)=>a+x.mismatched,0);
  return {
    state:mismatched?"SYNTHETIC_SEMANTIC_VALUE_GAPS":
      "SYNTHETIC_SEMANTIC_VALUES_MATCH",
    rows:input.rows.length,matched,mismatched,tables,
    originalAccessFileVerified:false,databaseOriginAuthenticated:false,
    clinicalOrFinancialSignoff:false,importOrCutoverAuthorized:false,
  };
}
