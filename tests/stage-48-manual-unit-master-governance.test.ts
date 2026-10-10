import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  manualUnitIdentityError, manualUnitInputError,
} from "../src/lib/catalog-manual-unit-governance.ts";

const candidate = {
  code: "UG_ML", symbol: "µg/mL", nameEn: "Micrograms per milliliter",
  nameAr: "", ucumCode: "ug/mL",
};

test("Stage 48: manual unit code/symbol aliases collide across fields and inactive records", () => {
  const old = {id:"old",code:"OLD",symbol:"μg/mL",status:"ACTIVE"};
  const inactive = {id:"disabled",code:"INACTIVE",symbol:"mg/dL",status:"INACTIVE"};
  assert.equal(manualUnitIdentityError([old],candidate),"unit_alias_conflict");
  assert.equal(manualUnitIdentityError([{...old,symbol:"unknown",code:"ug/ml"}],candidate),"unit_alias_conflict");
  assert.equal(manualUnitIdentityError([{...old,symbol:"unknown",code:"ug_ml"}],candidate),"unit_alias_conflict");
  assert.equal(manualUnitIdentityError([inactive],{code:"MG",symbol:" mg PER dL. "}),"unit_alias_conflict");
  assert.equal(manualUnitIdentityError([old,inactive],{code:"GLU_NEW",symbol:"mmol/L"}),null);
  assert.equal(manualUnitIdentityError([inactive,old],{code:"GLU_NEW",symbol:"mmol/L"}),null);
});

test("Stage 48: no silent truncation, control codes, or invented UCUM conversions",()=>{
  assert.equal(manualUnitInputError(candidate),null);
  for(const x of [
    {...candidate,code:"X".repeat(51)},
    {...candidate,symbol:"x".repeat(51)},
    {...candidate,nameEn:"x".repeat(151)},
    {...candidate,nameAr:"x".repeat(151)},
    {...candidate,ucumCode:"X".repeat(51)},
    {...candidate,symbol:"\n"},
    {...candidate,nameEn:"Patient\nData"},
    {...candidate,code:"invalid code"},
    {...candidate,symbol:""},
  ]) assert.equal(manualUnitInputError(x),"invalid_unit_fields");
  assert.equal(manualUnitInputError({...candidate,code:"A".repeat(50)}),null);
  assert.equal(manualUnitIdentityError([],candidate),null);
});

test("Stage 48: route locks organization, validates live branch grant and audits unit atomically",()=>{
 const src=readFileSync("src/app/api/catalog/master-data/route.ts","utf8");
 assert.match(src,/if \(type === "units"\)/);
 assert.match(src,/manualUnitInputError\(candidate\)/);
 assert.match(src,/WHERE id = \$\{session\.user\.organizationId\} AND status = 'ACTIVE' FOR UPDATE/);
 assert.match(src,/tx\.userBranchScope\.findUnique/);
 assert.match(src,/tx\.branch\.findFirst/);
 assert.match(src,/tx\.unit\.findMany/);
 assert.match(src,/manualUnitIdentityError\(currentUnits, candidate\)/);
 assert.match(src,/tx\.unit\.create/);
 assert.match(src,/tx\.auditEvent\.create/);
 assert.ok(src.indexOf("const organization = await tx.$queryRaw")<src.indexOf("const currentUnits = await tx.unit.findMany"));
 assert.ok(src.indexOf("const conflict = manualUnitIdentityError")<src.indexOf("const created = await tx.unit.create"));
 assert.match(src,/newValues: \{ code: created\.code, nameEn: created\.nameEn, symbol: created\.symbol \}/);
 assert.match(src,/unit_alias_conflict|manualUnitIdentityError/);
 assert.doesNotMatch(src,/symbol:.*\.slice\(0, 50\)/);
});
