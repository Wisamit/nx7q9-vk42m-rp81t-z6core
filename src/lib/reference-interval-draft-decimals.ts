import { ClinicalDecimalError, parseClinicalRuleDecimal } from "./clinical-rule-decimal.ts";

export type ClinicalRangeDecimalFields = {
  ageFrom: string | null;
  ageTo: string | null;
  gestationalAgeFromWeeks: string | null;
  gestationalAgeToWeeks: string | null;
  lowValue: string | null;
  highValue: string | null;
  criticalLow: string | null;
  criticalHigh: string | null;
};
export type ClinicalRangeAdmission =
  | {ok:true;values:ClinicalRangeDecimalFields}
  | {ok:false;error:
      "invalid_numeric_value"|"invalid_age_range"|
      "invalid_gestational_age_range"|"invalid_range"|
      "invalid_critical_range"};

const age={precision:10,scale:3,nonNegative:true} as const;
const gestational={precision:6,scale:2,nonNegative:true} as const;
const interval={precision:18,scale:6} as const;

function scaled(value:string):bigint {
  // The parser already enforces fixed DB precision/scale and a literal
  // decimal string. Removing the dot is exact even beyond JS safe integers.
  return BigInt(value.replace(".",""));
}
export function compareReferenceDecimal(left:string,right:string):number {
  const a=scaled(left),b=scaled(right);
  return a<b?-1:a>b?1:0;
}

/**
 * Server-only admission for new INACTIVE/DRAFT clinical range values.
 * No JSON numbers/IEEE754 conversion, unit inference, rounding or automatic
 * clinical approval. Uses the exact MySQL DECIMAL precision of every column.
 */
export function validateReferenceRangeDecimals(body:unknown):ClinicalRangeAdmission {
  const invalid={ok:false,error:"invalid_numeric_value"} as const;
  if(body===null||typeof body!=="object"||Array.isArray(body))return invalid;
  const input=body as Record<string,unknown>;
  let values:ClinicalRangeDecimalFields;
  try {
    values={
      ageFrom:parseClinicalRuleDecimal(input.ageFrom,age),
      ageTo:parseClinicalRuleDecimal(input.ageTo,age),
      gestationalAgeFromWeeks:parseClinicalRuleDecimal(input.gestationalAgeFromWeeks,gestational),
      gestationalAgeToWeeks:parseClinicalRuleDecimal(input.gestationalAgeToWeeks,gestational),
      lowValue:parseClinicalRuleDecimal(input.lowValue,interval),
      highValue:parseClinicalRuleDecimal(input.highValue,interval),
      criticalLow:parseClinicalRuleDecimal(input.criticalLow,interval),
      criticalHigh:parseClinicalRuleDecimal(input.criticalHigh,interval),
    };
  }catch(error) {
    if(error instanceof ClinicalDecimalError)return invalid;
    throw error;
  }
  if(values.ageFrom!==null&&values.ageTo!==null&&
      compareReferenceDecimal(values.ageFrom,values.ageTo)>0)
    return {ok:false,error:"invalid_age_range"};
  if(values.gestationalAgeFromWeeks!==null&&values.gestationalAgeToWeeks!==null&&
      compareReferenceDecimal(values.gestationalAgeFromWeeks,values.gestationalAgeToWeeks)>0)
    return {ok:false,error:"invalid_gestational_age_range"};
  if(values.lowValue!==null&&values.highValue!==null&&
      compareReferenceDecimal(values.lowValue,values.highValue)>0)
    return {ok:false,error:"invalid_range"};
  if(values.criticalLow!==null&&values.criticalHigh!==null&&
      compareReferenceDecimal(values.criticalLow,values.criticalHigh)>0)
    return {ok:false,error:"invalid_critical_range"};
  return {ok:true,values};
}


/**
 * Effective date is a legally/clinically meaningful version boundary.
 * Accept an exact UTC ISO calendar day or fully specified UTC timestamp;
 * reject rollover (e.g. February 30), unqualified local clocks and offsets.
 * Absence retains the existing new-DRAFT current-UTC-time default.
 */
export function parseReferenceIntervalEffectiveFrom(value:unknown):Date|null {
  if(value===undefined||value===null||value==="")return new Date();
  if(typeof value!=="string")return null;
  const day=/^\d{4}-\d{2}-\d{2}$/.test(value);
  const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
  if(!day&&!timestamp)return null;
  const normalized=day?value+"T00:00:00.000Z":
    value.endsWith("Z") && !value.includes(".")?value.slice(0,-1)+".000Z":value;
  const at=new Date(normalized);
  if(!Number.isFinite(at.getTime())||at.toISOString()!==normalized)return null;
  return at;
}
