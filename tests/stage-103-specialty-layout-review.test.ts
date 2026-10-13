import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseSpecialtyLayoutPlan,specialtySnapshotDigest,specialtyReviewToken,specialtyPlanPreview,
  type SpecialtySnapshot,
} from "../src/lib/specialty-layout-review.ts";

const snapshot:SpecialtySnapshot={
  layout:"STANDARD",testUpdatedAt:"2026-10-13T08:00:00.000Z",
  sections:[{id:"s1",code:"A",nameEn:"A",nameAr:null,displayOrder:0,columnCount:2,hintEn:null,hintAr:null,
    status:"ACTIVE",updatedAt:"2026-10-13T08:00:00.000Z",reportVisible:true,reportDisplayOrder:null}],
  components:[
    {id:"c1",code:"C1",sectionCode:"A",resultSectionId:"s1",entryWidth:"AUTO",entryHintEn:null,entryHintAr:null,
      status:"ACTIVE",updatedAt:"2026-10-13T08:00:00.000Z",reportVisible:true,reportDisplayOrder:null,
      reportNameEn:null,reportNameAr:null},
    {id:"c2",code:"C2",sectionCode:null,resultSectionId:null,entryWidth:"AUTO",entryHintEn:null,entryHintAr:null,
      status:"ACTIVE",updatedAt:"2026-10-13T08:00:00.000Z",reportVisible:true,reportDisplayOrder:null,
      reportNameEn:null,reportNameAr:null},
  ],
};
const plan={layout:"COMPACT_GRID",
  sections:[{code:"A",nameEn:"Clinical Panel",nameAr:"قسم",displayOrder:0,columnCount:3,hintEn:"Confirm barcode",hintAr:null}],
  components:[{code:"C1",sectionCode:"A",entryWidth:"NARROW",entryHintEn:null,entryHintAr:null},
    {code:"C2",sectionCode:"A",entryWidth:"WIDE",entryHintEn:null,entryHintAr:null}],
};
const valid=()=>structuredClone(plan);
test("stage 103: complete generic specialty plan is validated without test-name assumptions",()=>{
  const normalized=parseSpecialtyLayoutPlan(valid(),snapshot);
  assert.equal(normalized.layout,"COMPACT_GRID");
  assert.equal(normalized.components.length,2);
  assert.equal(normalized.sections[0].nameAr,"قسم");
  const preview=specialtyPlanPreview(snapshot,normalized);
  assert.deepEqual(preview.sectionsCreated,[]);
  assert.deepEqual(preview.sectionsUpdated,["A"]);
  assert.deepEqual(preview.componentsUpdated,["C1","C2"]);
  assert.equal(preview.layoutChanged,true);
  assert.equal(preview.affected,4);
});
test("stage 103: reject missing, repeated, unknown, or inactive clinical components",()=>{
  const noComponent=valid();noComponent.components.pop();
  assert.throws(()=>parseSpecialtyLayoutPlan(noComponent,snapshot),/every_active_component/);
  const repeated=valid();repeated.components[1].code="C1";
  assert.throws(()=>parseSpecialtyLayoutPlan(repeated,snapshot),/invalid_or_duplicate_component/);
  const foreign=valid();foreign.components[1].code="OTHER_ORG";
  assert.throws(()=>parseSpecialtyLayoutPlan(foreign,snapshot),/invalid_or_duplicate_component/);
  const inactive=structuredClone(snapshot);
  inactive.components[1].status="INACTIVE";
  assert.throws(()=>parseSpecialtyLayoutPlan(valid(),inactive),/every_active_component/);
});
test("stage 103: section collisions, absent assignments and invalid grid configurations fail closed",()=>{
  const repeated=valid();repeated.sections.push({...repeated.sections[0]});
  assert.throws(()=>parseSpecialtyLayoutPlan(repeated,snapshot),/invalid_or_duplicate_section/);
  const unmatched=valid();unmatched.components[1].sectionCode="UNKNOWN";
  assert.throws(()=>parseSpecialtyLayoutPlan(unmatched,snapshot),/invalid_or_duplicate_component/);
  const columns=valid();columns.sections[0].columnCount=5;
  assert.throws(()=>parseSpecialtyLayoutPlan(columns,snapshot),/invalid_or_duplicate_section/);
  const inactive=structuredClone(snapshot);inactive.sections[0].status="INACTIVE";
  assert.throws(()=>parseSpecialtyLayoutPlan(valid(),inactive),/inactive_section_code_collision/);
  const badName=valid();badName.sections[0].nameEn="";
  assert.throws(()=>parseSpecialtyLayoutPlan(badName,snapshot),/invalid_or_duplicate_section/);
});
test("stage 103: same plan and same snapshot produce stable tokens, concurrent changes invalidate them",()=>{
  const normalized=parseSpecialtyLayoutPlan(valid(),snapshot);
  const hash=specialtySnapshotDigest(snapshot),token=specialtyReviewToken(hash,normalized);
  assert.equal(hash,specialtySnapshotDigest(structuredClone(snapshot)));
  assert.equal(token,specialtyReviewToken(hash,normalized));
  assert.notEqual(specialtyReviewToken(hash,{...normalized,layout:"SECTIONED"}),token);
  const changed=structuredClone(snapshot);changed.sections[0].hintEn="New instructions";
  assert.notEqual(specialtySnapshotDigest(changed),hash);
  const changedComponent=structuredClone(snapshot);changedComponent.components[0].updatedAt="2026-10-13T09:00:00.000Z";
  assert.notEqual(specialtySnapshotDigest(changedComponent),hash);
});
test("stage 103: omitted existing sections are preserved and non-apply fields remain untouched",()=>{
  const planNoSections=valid();planNoSections.layout="STANDARD";planNoSections.sections=[];
  planNoSections.components.forEach(c=>{c.sectionCode=null;});
  const normalized=parseSpecialtyLayoutPlan(planNoSections,snapshot);
  const preview=specialtyPlanPreview(snapshot,normalized);
  assert.deepEqual(preview.unchangedActiveSections,["A"]);
  const route=readFileSync("src/app/api/catalog/specialty-layout-batch/route.ts","utf8");
  assert.match(route,/Prisma\.TransactionIsolationLevel\.Serializable/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/layout_changed_repreview_required/);
  assert.match(route,/reviewed_plan_changed/);
  assert.match(route,/actorUserId:session.userId/);
  assert.doesNotMatch(route,/diagnosticReportVersion\.(update|delete)/);
  assert.doesNotMatch(route,/laboratoryResult\.(update|delete)/);
  assert.doesNotMatch(route,/referenceInterval\.(update|delete)/);
  assert.doesNotMatch(route,/testResultSection\.delete/);
});
