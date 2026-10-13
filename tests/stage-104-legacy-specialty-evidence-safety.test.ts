import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSpecialtyEvidenceReview, LEGACY_SPECIALTY_EVIDENCE_TYPE,
  LegacySpecialtyEvidenceError, parseSpecialtyEvidence,
} from "../src/lib/legacy-specialty-evidence.ts";

const evidence=()=>({
  schemaVersion:1,evidenceType:LEGACY_SPECIALTY_EVIDENCE_TYPE,
  sourceName:"Family lab -test.mdb",sourceSha256:"a".repeat(64),
  exportedAtUtc:"2026-10-13T07:00:00.000Z",clinicalUseApproved:false,
  tables:[
    {tableName:"Thyroidn",pairingComplete:true,warnings:[],candidatePairs:[
      {sourcePrefix:"TSH",lowColumn:"TSHL",highColumn:"TSHH",observations:[
        {rowNumber:1,low:"1.2",high:"4.5",sex:"F",ageFrom:"0",ageTo:"100",ageUnit:"YEAR"},
        {rowNumber:3,low:"5",high:"3",sex:"UNKNOWN_CODE",ageFrom:null,ageTo:null,ageUnit:null},
        {rowNumber:5,low:null,high:"9.2",sex:null,ageFrom:null,ageTo:null,ageUnit:null},
      ]},
      {sourcePrefix:"T3",lowColumn:"T3LOW",highColumn:"T3HIGH",observations:[]},
    ]},
    {tableName:"cbcn",pairingComplete:false,warnings:["No confidently paired columns."],candidatePairs:[]},
  ],
});
const failCode=(fn:()=>unknown,code:string)=>assert.throws(fn,
  error=>error instanceof LegacySpecialtyEvidenceError&&error.code===code);

test("Stage 104: only explicit specialty tables, schema, and not-approved evidence are accepted",()=>{
  const data=parseSpecialtyEvidence(evidence());
  assert.equal(data.tables.length,2);
  const changed=evidence();changed.tables[0].tableName="ID";
  failCode(()=>parseSpecialtyEvidence(changed),"invalid_or_unapproved_specialty_table");
  const extra=evidence();extra.tables.push({...extra.tables[0]});
  failCode(()=>parseSpecialtyEvidence(extra),"invalid_or_unapproved_specialty_table");
  const approval=evidence();approval.clinicalUseApproved=true;
  failCode(()=>parseSpecialtyEvidence(approval),"invalid_specialty_evidence_header");
  const unsafe=evidence();unsafe.sourceName="../patients.mdb";
  failCode(()=>parseSpecialtyEvidence(unsafe),"invalid_specialty_evidence_header");
});

test("Stage 104: nonnumeric intervals, repeated rows, and malformed range pairing fail closed",()=>{
  const malformed=evidence();malformed.tables[0].candidatePairs[0].observations[0].low="patient1";
  failCode(()=>parseSpecialtyEvidence(malformed),"invalid_or_non_numeric_specialty_observation");
  const repeated=evidence();repeated.tables[0].candidatePairs[0].observations[1].rowNumber=1;
  failCode(()=>parseSpecialtyEvidence(repeated),"invalid_or_non_numeric_specialty_observation");
  const inconsistent=evidence();inconsistent.tables[0].pairingComplete=false;
  failCode(()=>parseSpecialtyEvidence(inconsistent),"inconsistent_specialty_pairing_status");
  const duplicate=evidence();duplicate.tables[0].candidatePairs[1].sourcePrefix="TSH";
  failCode(()=>parseSpecialtyEvidence(duplicate),"invalid_or_duplicate_specialty_pair");
});

test("Stage 104: exact configured component code match is only a mapping hint, not clinical approval",()=>{
  const source=parseSpecialtyEvidence(evidence());
  const review=buildSpecialtyEvidenceReview(source,[
    {id:"c1",code:"TSH",nameEn:"Thyroid-stimulating hormone",nameAr:null},
    {id:"c2",code:"WBC",nameEn:"White blood cells",nameAr:null},
  ]);
  assert.equal(review.reviewOnly,true);
  assert.equal(review.imported,false);
  assert.equal(review.clinicalUseApproved,false);
  assert.equal(review.totalCandidatePairs,2);
  assert.equal(review.unmatchedPairs,1);
  const tsh=review.tables[0].pairs[0],t3=review.tables[0].pairs[1];
  assert.equal(tsh.matchStatus,"EXACT_COMPONENT_CODE");
  assert.equal(tsh.matchedComponentCode,"TSH");
  assert.equal(tsh.observationCount,3);
  assert.equal(tsh.invertedBounds,1);
  assert.equal(tsh.incompleteBounds,1);
  assert.equal(tsh.unknownSelectors,1);
  assert.equal(t3.matchStatus,"NO_EXACT_CODE_MATCH");
  assert.ok(!JSON.stringify(review).includes('"low":"1.2"'),"never echo raw clinical observations");
  const duplicates=buildSpecialtyEvidenceReview(source,[
    {id:"c1",code:"TSH",nameEn:"Test A",nameAr:null},
    {id:"c2",code:"tsh",nameEn:"Test B",nameAr:null},
  ]);
  assert.equal(duplicates.tables[0].pairs[0].matchStatus,"AMBIGUOUS_CODE");
});

test("Stage 104: no live medical, billing, historical, or catalog write path in review route",()=>{
  const route=readFileSync("src/app/api/catalog/legacy-specialty-evidence/route.ts","utf8");
  const exporter=readFileSync("scripts/legacy/export-specialty-reference-evidence.ps1","utf8");
  assert.match(route,/requirePermission\("catalog\.manage"\)/);
  assert.match(route,/canAccessBranch/);
  assert.match(route,/organizationId:session\.user\.organizationId/);
  assert.match(route,/legacy-specialty-evidence/);
  assert.doesNotMatch(route,/\.(create|update|upsert|delete|createMany|updateMany)\(/);
  assert.doesNotMatch(route,/sourceData:/);
  assert.match(exporter,/\$knownSpecialties/);
  assert.match(exporter,/GetSchema\("Columns"/);
  assert.match(exporter,/Get-FileHash/);
  assert.match(exporter,/clinicalUseApproved = \$false/);
  assert.doesNotMatch(exporter,/SELECT \*/i);
  assert.doesNotMatch(exporter,/Read-Table "ID"/i);
});
