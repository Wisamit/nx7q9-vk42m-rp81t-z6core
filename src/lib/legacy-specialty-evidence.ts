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
  if(!object(payload)||payload.schemaVersion!==1||payload.evidenceType!==LEGACY_SPECIALTY_EVIDENCE_TYPE
    ||payload.clinicalUseApproved!==false||!boundedText(payload.sourceName,255)
    ||/[\/\\]/.test(payload.sourceName)||!/^.+\.(mdb|accdb)$/i.test(payload.sourceName)
    ||typeof payload.sourceSha256!=="string"||!/^[a-f0-9]{64}$/.test(payload.sourceSha256)
    ||typeof payload.exportedAtUtc!=="string"||!/\d{4}-\d\d-\d\dT\d\d:\d\d/.test(payload.exportedAtUtc)
    ||!Array.isArray(payload.tables)||payload.tables.length<1||payload.tables.length>10) {
    invalid("invalid_specialty_evidence_header");
  }
  const tables:SpecialtyEvidenceTable[]=[];
  const seenTables=new Set<string>();
  let globalObservations=0;
  for(const raw of payload.tables){
    if(!object(raw)||!allowedName(raw.tableName)||!trustedTables.has(raw.tableName.toLowerCase())
      ||seenTables.has(raw.tableName.toLowerCase())
      ||typeof raw.pairingComplete!=="boolean"
      ||!Array.isArray(raw.warnings)||raw.warnings.length>10||raw.warnings.some(x=>typeof x!=="string"||x.length>500)
      ||!Array.isArray(raw.candidatePairs)||raw.candidatePairs.length>200) {
      invalid("invalid_or_unapproved_specialty_table");
    }
    seenTables.add(raw.tableName.toLowerCase());
    if(raw.pairingComplete!==(raw.candidatePairs.length>0))
      invalid("inconsistent_specialty_pairing_status");
    const pairs:SpecialtyEvidencePair[]=[];
    const seenPrefix=new Set<string>();
    for(const rawPair of raw.candidatePairs){
      if(!object(rawPair)||!allowedName(rawPair.sourcePrefix)||!allowedName(rawPair.lowColumn)
        ||!allowedName(rawPair.highColumn)
        ||seenPrefix.has(rawPair.sourcePrefix.toUpperCase())
        ||rawPair.lowColumn.toLowerCase()===rawPair.highColumn.toLowerCase()
        ||!Array.isArray(rawPair.observations)||rawPair.observations.length>20000) {
        invalid("invalid_or_duplicate_specialty_pair");
      }
      seenPrefix.add(rawPair.sourcePrefix.toUpperCase());
      const rows:SpecialtyEvidenceObservation[]=[];
      let previousRow=0;
      for(const row of rawPair.observations){
        if(!object(row)||typeof row.rowNumber!=="number"||!Number.isInteger(row.rowNumber)
          ||row.rowNumber<=previousRow||row.rowNumber>20000
          ||!optionalDecimal(row.low)||!optionalDecimal(row.high)
          ||(row.low===null&&row.high===null)
          ||!optionalText(row.sex)||!optionalText(row.ageFrom)
          ||!optionalText(row.ageTo)||!optionalText(row.ageUnit)) {
          invalid("invalid_or_non_numeric_specialty_observation");
        }
        previousRow=row.rowNumber;
        globalObservations++;
        if(globalObservations>50000) invalid("specialty_evidence_exceeds_review_limit");
        rows.push({
          rowNumber:row.rowNumber,low:row.low,high:row.high,sex:row.sex,
          ageFrom:row.ageFrom,ageTo:row.ageTo,ageUnit:row.ageUnit,
        });
      }
      pairs.push({sourcePrefix:rawPair.sourcePrefix,lowColumn:rawPair.lowColumn,
        highColumn:rawPair.highColumn,observations:rows});
    }
    tables.push({tableName:raw.tableName,candidatePairs:pairs,
      pairingComplete:raw.pairingComplete,warnings:raw.warnings});
  }
  return {schemaVersion:1,evidenceType:LEGACY_SPECIALTY_EVIDENCE_TYPE,
    sourceName:payload.sourceName as string,sourceSha256:payload.sourceSha256 as string,
    exportedAtUtc:payload.exportedAtUtc as string,clinicalUseApproved:false,tables};
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
