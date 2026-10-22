/**
 * Lossless validation of imported numeric reference limits. The source wire
 * format is a decimal string from Prisma.Decimal; JavaScript Number must not
 * decide a patient-facing or critical threshold comparison.
 */
type NumericField=
  "ageFrom"|"ageTo"|"gestationalAgeFromWeeks"|"gestationalAgeToWeeks"|
  "lowValue"|"highValue"|"criticalLow"|"criticalHigh";
const widths:Record<NumericField,readonly [number,number]>={
  ageFrom:[7,3],ageTo:[7,3],
  gestationalAgeFromWeeks:[4,2],gestationalAgeToWeeks:[4,2],
  lowValue:[12,6],highValue:[12,6],
  criticalLow:[12,6],criticalHigh:[12,6],
};
const isRecord=(v:unknown):v is Record<string,unknown>=>
  v!==null && typeof v==="object" && !Array.isArray(v);

function decimalValue(raw:unknown,integerDigits:number,fractionDigits:number):bigint|null|undefined{
  if(raw===null)return null;
  if(typeof raw!=="string")return undefined;
  const regex=new RegExp(`^(-?)(?:0|[1-9][0-9]{0,${integerDigits-1}})(?:\\.([0-9]{1,${fractionDigits}}))?$`);
  const match=regex.exec(raw);
  if(!match)return undefined;
  const sign=match[1]==="-"?-BigInt(1):BigInt(1);
  const [intPart,fraction=""]=raw.replace(/^-/, "").split(".");
  return sign*BigInt(intPart+fraction.padEnd(fractionDigits,"0"));
}
/**
 * null = unbounded; undefined/missing = malformed. All bounded intervals
 * must be ordered; age ranges cannot be negative. No assumptions about
 * whether a critical threshold is necessarily outside a normal interval.
 */
export function validF2ClinicalIntervalNumbers(value:unknown):boolean{
  if(!isRecord(value))return false;
  const v={} as Record<NumericField,bigint|null|undefined>;
  for(const field of Object.keys(widths) as NumericField[]){
    const [integer,fraction]=widths[field];
    if(!Object.hasOwn(value,field))return false;
    v[field]=decimalValue(value[field],integer,fraction);
    if(v[field]===undefined)return false;
  }
  for(const field of ["ageFrom","ageTo","gestationalAgeFromWeeks",
    "gestationalAgeToWeeks"] as NumericField[]){
    if(v[field]!==null && v[field]! < BigInt(0))return false;
  }
  for(const [low,high] of [
    ["ageFrom","ageTo"],["gestationalAgeFromWeeks","gestationalAgeToWeeks"],
    ["lowValue","highValue"],["criticalLow","criticalHigh"],
  ] as readonly (readonly [NumericField,NumericField])[]){
    if(v[low]!==null && v[high]!==null && v[low]!>v[high]!)return false;
  }
  return true;
}
