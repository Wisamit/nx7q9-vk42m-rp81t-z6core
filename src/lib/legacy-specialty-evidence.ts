import { createHash } from "node:crypto";

export const LEGACY_SPECIALTY_EVIDENCE_TYPE = "FAMILY_LAB_LEGACY_SPECIALTY_RANGES_REVIEW_ONLY";
export const LEGACY_SPECIALTY_EVIDENCE_TABLES = [
  "cbcn", "coagn", "fertn", "Glycosen", "kidnyn", "lipidn", "livern",
  "Thyroidn", "TORCHn", "Tumern",
] as const;
export const LEGACY_SPECIALTY_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024;
export type SpecialtyEvidenceObservation = {
  rowNumber: number; low: string|null; high: string|null; sex: string|null;
  ageFrom: string|null; ageTo: string|null; ageUnit: string|null;
};
export type SpecialtyEvidencePair = {
  sourcePrefix:string; lowColumn:string; highColumn:string;
  observations:SpecialtyEvidenceObservation[];
};
export type SpecialtyEvidenceTable = {
  tableName:string; candidatePairs:SpecialtyEvidencePair[];
  pairingComplete:boolean; warnings:string[];
};
export type SpecialtyEvidence = {
  schemaVersion:1; evidenceType:typeof LEGACY_SPECIALTY_EVIDENCE_TYPE;
  sourceName:string; sourceSha256:string; exportedAtUtc:string;
  clinicalUseApproved:false; tables:SpecialtyEvidenceTable[];
};
export class LegacySpecialtyEvidenceError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.code=code;}
}
const invalid=(code:string):never=>{throw new LegacySpecialtyEvidenceError(code);};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const boundedText=(v:unknown,max=100):v is string=>typeof v==="string"&&v.length>0&&v.length<=max
  &&!/[\u0000-\u001f\u007f]/.test(v);
const allowedName=(v:unknown):v is string=>boundedText(v,100)&&!/[\/\\]/.test(v);
const optionalText=(v:unknown,max=32):v is string|null=>v===null||(typeof v==="string"&&v.length<=max
  &&!/[\u0000-\u001f\u007f]/.test(v));
const dec=/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,8})?$/;
const optionalDecimal=(v:unknown):v is string|null=>v===null||(typeof v==="string"&&v.length<=24&&dec.test(v));
const trustedTables=new Set<string>(LEGACY_SPECIALTY_EVIDENCE_TABLES.map(x=>x.toLowerCase()));

export function parseSpecialtyEvidence(payload:unknown):SpecialtyEvidence {
  if(!object(payload)) invalid("invalid_specialty_evidence_header");
  const doc = payload as Record<string, unknown>;
  if(doc.schemaVersion!==1||doc.evidenceType!==LEGACY_SPECIALTY_EVIDENCE_TYPE
    ||doc.clinicalUseApproved!==false||!boundedText(doc.sourceName,255)
    ||/[\/\\]/.test(doc.sourceName)||!/^.+\.(mdb|accdb)$/i.test(doc.sourceName)
    ||typeof doc.sourceSha256!=="string"||!/^[a-f0-9]{64}$/.test(doc.sourceSha256)
    ||typeof doc.exportedAtUtc!=="string"||!/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(doc.exportedAtUtc)
    ||!Array.isArray(doc.tables)||doc.tables.length<1||doc.tables.length>10) {
    invalid("invalid_specialty_evidence_header");
  }
  const tables:SpecialtyEvidenceTable[]=[];
  const sources = doc.tables as unknown[];
  const seenTables=new Set<string>();
  let globalObservations=0;
  for(const sourceTable of sources){
    if(!object(sourceTable)) invalid("invalid_or_unapproved_specialty_table");
    const raw = sourceTable as Record<string, unknown>;
    if(!allowedName(raw.tableName)||!trustedTables.has(raw.tableName.toLowerCase())
      ||seenTables.has(raw.tableName.toLowerCase())
      ||typeof raw.pairingComplete!=="boolean"
      ||!Array.isArray(raw.warnings)||raw.warnings.length>10||raw.warnings.some(x=>typeof x!=="string"||x.length>500)
      ||!Array.isArray(raw.candidatePairs)||raw.candidatePairs.length>200) {
      invalid("invalid_or_unapproved_specialty_table");
    }
    const tableName = raw.tableName as string;
    seenTables.add(tableName.toLowerCase());
    if(raw.pairingComplete!==(raw.candidatePairs.length>0))
      invalid("inconsistent_specialty_pairing_status");
    const pairs:SpecialtyEvidencePair[]=[];
    const seenPrefix=new Set<string>();
    for(const pairInput of raw.candidatePairs as unknown[]){
      if(!object(pairInput)) invalid("invalid_or_duplicate_specialty_pair");
      const rawPair = pairInput as Record<string, unknown>;
      if(!allowedName(rawPair.sourcePrefix)||!allowedName(rawPair.lowColumn)
        ||!allowedName(rawPair.highColumn)
        ||seenPrefix.has(rawPair.sourcePrefix.toUpperCase())
        ||rawPair.lowColumn.toLowerCase()===rawPair.highColumn.toLowerCase()
        ||!Array.isArray(rawPair.observations)||rawPair.observations.length>20000) {
        invalid("invalid_or_duplicate_specialty_pair");
      }
      const sourcePrefix = rawPair.sourcePrefix as string;
      seenPrefix.add(sourcePrefix.toUpperCase());
      const rows:SpecialtyEvidenceObservation[]=[];
      let previousRow=0;
      for(const input of rawPair.observations as unknown[]){
        if(!object(input)) invalid("invalid_or_non_numeric_specialty_observation");
        const row = input as Record<string, unknown>;
        if(typeof row.rowNumber!=="number"||!Number.isInteger(row.rowNumber)
          ||row.rowNumber<=previousRow||row.rowNumber>20000
          ||!optionalDecimal(row.low)||!optionalDecimal(row.high)
          ||(row.low===null&&row.high===null)
          ||!optionalText(row.sex)||!optionalText(row.ageFrom)
          ||!optionalText(row.ageTo)||!optionalText(row.ageUnit)) {
          invalid("invalid_or_non_numeric_specialty_observation");
        }
        const rowNumber = row.rowNumber as number;
        previousRow=rowNumber;
        globalObservations++;
        if(globalObservations>50000) invalid("specialty_evidence_exceeds_review_limit");
        rows.push({
          rowNumber,low:row.low as string|null,high:row.high as string|null,
          sex:row.sex as string|null,ageFrom:row.ageFrom as string|null,
          ageTo:row.ageTo as string|null,ageUnit:row.ageUnit as string|null,
        });
      }
      pairs.push({sourcePrefix,lowColumn:rawPair.lowColumn as string,
        highColumn:rawPair.highColumn as string,observations:rows});
    }
    tables.push({tableName,candidatePairs:pairs,
      pairingComplete:raw.pairingComplete as boolean,warnings:raw.warnings as string[]});
  }
  return {schemaVersion:1,evidenceType:LEGACY_SPECIALTY_EVIDENCE_TYPE,
    sourceName:doc.sourceName as string,sourceSha256:doc.sourceSha256 as string,
    exportedAtUtc:doc.exportedAtUtc as string,clinicalUseApproved:false,tables};
}

export type MatchingComponent = {id:string;code:string;nameEn:string;nameAr:string|null};
export type EvidencePairReview = {
  prefix:string;lowColumn:string;highColumn:string;observationCount:number;
  incompleteBounds:number;invertedBounds:number;unknownSelectors:number;
  matchStatus:"EXACT_COMPONENT_CODE"|"NO_EXACT_CODE_MATCH"|"AMBIGUOUS_CODE";
  matchedComponentId:string|null;matchedComponentCode:string|null;
};
export function buildSpecialtyEvidenceReview(evidence:SpecialtyEvidence,components:MatchingComponent[]){
  const byCode=new Map<string,MatchingComponent[]>();
  for(const component of components){
    const key=component.code.toUpperCase();
    byCode.set(key,[...(byCode.get(key)||[]),component]);
  }
  const tables=evidence.tables.map(table=>({
    tableName:table.tableName,pairingComplete:table.pairingComplete,warnings:table.warnings,
    pairs:table.candidatePairs.map(pair=>{
      const matches=byCode.get(pair.sourcePrefix.toUpperCase())||[];
      const incompleteBounds=pair.observations.filter(o=>o.low===null||o.high===null).length;
      const invertedBounds=pair.observations.filter(o=>o.low!==null&&o.high!==null
        &&Number(o.low)>Number(o.high)).length;
      const unknownSelectors=pair.observations.filter(o=>{
        if(o.sex&&!/^(M|F|MALE|FEMALE|BOTH|ALL|ANY|ذكر|أنثى|الكل)$/i.test(o.sex.trim()))return true;
        if(o.ageUnit&&!/^(Y|M|D|W|YEAR|YEARS|MONTH|MONTHS|DAY|DAYS|WEEK|WEEKS|سنة|سنوات|شهر|أشهر|يوم|أيام)$/i.test(o.ageUnit.trim()))return true;
        return false;
      }).length;
      return {
        prefix:pair.sourcePrefix,lowColumn:pair.lowColumn,highColumn:pair.highColumn,
        observationCount:pair.observations.length,incompleteBounds,invertedBounds,unknownSelectors,
        matchStatus:matches.length===1?"EXACT_COMPONENT_CODE" as const:matches.length===0
          ?"NO_EXACT_CODE_MATCH" as const:"AMBIGUOUS_CODE" as const,
        matchedComponentId:matches.length===1?matches[0].id:null,
        matchedComponentCode:matches.length===1?matches[0].code:null,
      };
    }),
  }));
  return {
    sourceName:evidence.sourceName,sourceSha256:evidence.sourceSha256,
    fileFingerprint:createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
    clinicalUseApproved:false,imported:false,reviewOnly:true,
    tableCount:tables.length,totalCandidatePairs:tables.reduce((n,t)=>n+t.pairs.length,0),
    unmatchedPairs:tables.reduce((n,t)=>n+t.pairs.filter(p=>p.matchStatus!=="EXACT_COMPONENT_CODE").length,0),
    tables,
  };
}
