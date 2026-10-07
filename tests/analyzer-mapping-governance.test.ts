import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzerMappingClinicallyUsable,
  analyzerMappingIdentityKey,
  analyzerMappingTargetUnitStillMatches,
  analyzerMappingUnitConfigurationError,
  analyzerMappingWindowsOverlap,
  planAnalyzerMappingApproval,
  sameAnalyzerMappingIdentity,
  snapshotAnalyzerMappingTargetUnit,
} from "../src/lib/analyzer-mapping-governance.ts";

const base={id:"MAP-1",analyzerId:"AN-1",analyzerTestCode:"GLU",effectiveFrom:new Date("2026-01-01T00:00:00.000Z"),effectiveTo:null};
const unit={id:"UNIT-1",code:"MG_DL",symbol:"mg/dL",ucumCode:"mg/dL"};

test("analyzer mappings are clinically usable only when approved active and effective",()=>{
  const at=new Date("2026-06-01T00:00:00.000Z");
  assert.equal(analyzerMappingClinicallyUsable({...base,status:"ACTIVE",approvalStatus:"APPROVED",approvedAt:new Date("2026-01-01T00:00:00.000Z")},at),true);
  assert.equal(analyzerMappingClinicallyUsable({...base,status:"INACTIVE",approvalStatus:"APPROVED",approvedAt:new Date("2026-01-01T00:00:00.000Z")},at),false);
  assert.equal(analyzerMappingClinicallyUsable({...base,status:"ACTIVE",approvalStatus:"DRAFT",approvedAt:null},at),false);
  assert.equal(analyzerMappingClinicallyUsable({...base,status:"ACTIVE",approvalStatus:"APPROVED",approvedAt:null},at),false);
  assert.equal(analyzerMappingClinicallyUsable({...base,effectiveFrom:new Date("2026-07-01T00:00:00.000Z"),status:"ACTIVE",approvalStatus:"APPROVED",approvedAt:new Date("2026-01-01T00:00:00.000Z")},at),false);
});

test("mapping clinical identity is analyzer plus analyzer test code",()=>{
  assert.equal(sameAnalyzerMappingIdentity(base,{analyzerId:"AN-1",analyzerTestCode:"GLU"}),true);
  assert.equal(sameAnalyzerMappingIdentity(base,{...base,analyzerId:"AN-2"}),false);
  assert.equal(sameAnalyzerMappingIdentity(base,{...base,analyzerTestCode:"GLU2"}),false);
  assert.equal(analyzerMappingIdentityKey(base),JSON.stringify(["AN-1","GLU"]));
});

test("mapping effective windows use closed overlap rules",()=>{
  assert.equal(analyzerMappingWindowsOverlap({effectiveFrom:new Date("2026-01-01"),effectiveTo:null},{effectiveFrom:new Date("2026-06-01"),effectiveTo:null}),true);
  assert.equal(analyzerMappingWindowsOverlap({effectiveFrom:new Date("2026-01-01"),effectiveTo:new Date("2026-02-01")},{effectiveFrom:new Date("2026-03-01"),effectiveTo:null}),false);
});

test("later mapping closes predecessor while same or later versions conflict",()=>{
  const draft={...base,id:"NEW",effectiveFrom:new Date("2026-06-01")};
  assert.deepEqual(planAnalyzerMappingApproval(draft,[{...base,id:"OLD",effectiveFrom:new Date("2026-01-01")}]),{predecessorsToClose:["OLD"],conflicts:[]});
  assert.deepEqual(planAnalyzerMappingApproval(draft,[{...base,id:"SAME",effectiveFrom:new Date("2026-06-01")},{...base,id:"LATER",effectiveFrom:new Date("2026-07-01")}]),{predecessorsToClose:[],conflicts:["SAME","LATER"]});
});

test("unit-bearing targets require analyzer unit code and unitless targets reject one",()=>{
  assert.equal(analyzerMappingUnitConfigurationError({analyzerUnitCode:"mg/dL",targetUnit:unit}),null);
  assert.equal(analyzerMappingUnitConfigurationError({analyzerUnitCode:null,targetUnit:unit}),"analyzer_unit_code_required_for_unit_target");
  assert.equal(analyzerMappingUnitConfigurationError({analyzerUnitCode:"mg/dL",targetUnit:null}),"analyzer_unit_requires_lis_target_unit");
  assert.equal(analyzerMappingUnitConfigurationError({analyzerUnitCode:null,targetUnit:null}),null);
});

test("approved target-unit snapshot fails closed when unit configuration changes",()=>{
  const snapshot=snapshotAnalyzerMappingTargetUnit(unit);
  assert.equal(analyzerMappingTargetUnitStillMatches(snapshot,unit),true);
  assert.equal(analyzerMappingTargetUnitStillMatches(snapshot,{...unit,symbol:"mmol/L"}),false);
  assert.equal(analyzerMappingTargetUnitStillMatches(snapshot,{...unit,id:"UNIT-2"}),false);
  assert.equal(analyzerMappingTargetUnitStillMatches(snapshot,null),false);
  assert.equal(analyzerMappingTargetUnitStillMatches(snapshotAnalyzerMappingTargetUnit(null),null),true);
});
