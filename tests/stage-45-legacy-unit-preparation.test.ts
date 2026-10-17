import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  eligibleLegacyUnitSourceRow, indexLegacyPreparedUnits, legacyPreparedUnitKey,
  proposedLegacyUnitCode, registerLegacyPreparedUnitAlias, resolveLegacyPreparedUnit,
} from "../src/lib/catalog-legacy-unit-preparation.ts";

test("Stage 45: colliding unit symbols and code aliases remain ambiguous regardless of row order", () => {
  const rows = [
    {id:"u1",code:"U1",symbol:"mg/dL",status:"ACTIVE"},
    {id:"u2",code:"U2",symbol:" mg / dL ",status:"ACTIVE"},
    {id:"u3",code:"U3",symbol:"mmol/L",status:"ACTIVE"},
  ];
  for(const units of [rows,[...rows].reverse()]) {
    const index=indexLegacyPreparedUnits(units);
    assert.deepEqual(resolveLegacyPreparedUnit(index,"MG/DL"),{kind:"ambiguous_or_inactive"});
    assert.deepEqual(resolveLegacyPreparedUnit(index," u1 "),{kind:"resolved",unitId:"u1"});
    assert.deepEqual(resolveLegacyPreparedUnit(index,"mmol/L"),{kind:"resolved",unitId:"u3"});
    assert.deepEqual(resolveLegacyPreparedUnit(index,"unmapped"),{kind:"unknown"});
  }
  const m=new Map<string,string|null>();
  registerLegacyPreparedUnitAlias(m,"CODE","u1","ACTIVE");
  registerLegacyPreparedUnitAlias(m," code ","u1","ACTIVE");
  assert.deepEqual(resolveLegacyPreparedUnit(m,"CODE"),{kind:"resolved",unitId:"u1"});
  registerLegacyPreparedUnitAlias(m,"CODE","u2","ACTIVE");
  registerLegacyPreparedUnitAlias(m,"CODE","u1","ACTIVE");
  assert.deepEqual(resolveLegacyPreparedUnit(m,"CODE"),{kind:"ambiguous_or_inactive"});
});

test("Stage 45: an inactive unit cannot be silently reactivated through an alias", () => {
  const active = {id:"active",code:"OK",symbol:"mg/L",status:"ACTIVE"};
  const inactive = {id:"old",code:"OLD",symbol:"ng/mL",status:"INACTIVE"};
  for(const units of [[active,inactive],[inactive,active]]) {
    const aliases=indexLegacyPreparedUnits(units);
    assert.deepEqual(resolveLegacyPreparedUnit(aliases,"ng/mL"),{kind:"ambiguous_or_inactive"});
    assert.deepEqual(resolveLegacyPreparedUnit(aliases,"mg/L"),{kind:"resolved",unitId:"active"});
  }
  assert.deepEqual(resolveLegacyPreparedUnit(indexLegacyPreparedUnits([
    active,{...inactive,symbol:"mg/L"},
  ]),"mg/L"),{kind:"ambiguous_or_inactive"});
  assert.equal(legacyPreparedUnitKey(" µ g PER dL. "), "UG/DL");
  assert.equal(legacyPreparedUnitKey("μg/mL"),"UG/ML");
  assert.equal(legacyPreparedUnitKey("Μg/mL"),"UG/ML");
  assert.equal(legacyPreparedUnitKey("µg/mL"),"UG/ML");
});

test("Stage 45: proposed unit values are not silently truncated into new identifiers", () => {
  assert.equal(proposedLegacyUnitCode("mg/dL"),"LEG_MG/DL");
  assert.equal(proposedLegacyUnitCode(""),null);
  assert.equal(proposedLegacyUnitCode("Z".repeat(47)),null);
  assert.equal(proposedLegacyUnitCode("Y".repeat(46)),"LEG_"+"Y".repeat(46));
  assert.equal(proposedLegacyUnitCode("A".repeat(51)),null);
});

test("Stage 45: only verified imported tests and pending valid/warning range sources can supply units", () => {
  const check=(entityType:string,status:string,importedEntityId:string|null=null)=>
    eligibleLegacyUnitSourceRow({entityType,status,importedEntityId});
  assert.equal(check("TEST","IMPORTED","master-id"),true);
  assert.equal(check("TEST","SKIPPED","master-id"),false);
  assert.equal(check("TEST","ERROR","master-id"),false);
  assert.equal(check("TEST","VALID","master-id"),false);
  assert.equal(check("TEST","IMPORTED"),false);
  assert.equal(check("REFERENCE_INTERVAL","WARNING"),true);
  assert.equal(check("REFERENCE_INTERVAL","VALID"),true);
  for(const status of ["ERROR","SKIPPED","IMPORTED","DRAFT","PENDING"]){
    assert.equal(check("REFERENCE_INTERVAL",status),false);
  }
  assert.equal(check("REFERENCE_INTERVAL","VALID","old-range"),false);
  assert.equal(check("PRICE_LIST_ITEM","VALID"),false);
});

test("Stage 45: the handler serializes identity discovery and CAS writes under tenant and branch gates", () => {
  const src=readFileSync("src/app/api/catalog/imports/[id]/prepare-units/route.ts","utf8");
  assert.match(src,/resolveClinicalImportScope\(/);
  assert.match(src,/active_clinical_import_scope_required/);
  assert.match(src,/WHERE id = \$\{scope\.organizationId\} AND status = 'ACTIVE' FOR UPDATE/);
  assert.match(src,/await liveLegacyClinicalWriteScope\(tx,/);
  assert.match(src,/AND organization_id = \$\{scope\.organizationId\} FOR UPDATE/);
  assert.match(src,/const currentBatch = await tx\.catalogImportBatch\.findFirst/);
  assert.match(src,/const eligibleRows = currentBatch\.rows\.filter\(eligibleLegacyUnitSourceRow\)/);
  assert.match(src,/const unitByKey = indexLegacyPreparedUnits\(units\)/);
  assert.match(src,/resolveLegacyPreparedUnit\(unitByKey, raw\)/);
  assert.match(src,/scopedTests\.length !== importedIds\.length/);
  assert.match(src,/legacy_test_department_or_branch_scope_denied/);
  assert.match(src,/tx\.labTest\.updateMany\(/);
  assert.match(src,/defaultUnitId: null, status: "ACTIVE"/);
  assert.match(src,/ambiguousUnits, unrepresentableUnits, unresolvedAssignments/);
  assert.ok(src.indexOf("const ownedOrganization = await tx.$queryRaw") <
    src.indexOf("const units = await tx.unit.findMany"));
  assert.ok(src.indexOf("const currentBatch = await tx.catalogImportBatch.findFirst") <
    src.indexOf("const unitByKey = indexLegacyPreparedUnits"));
  assert.doesNotMatch(src,/unitByKey\.set\(unitKey/);
  assert.doesNotMatch(src,/raw\.slice\(0, 50\)/);
});
