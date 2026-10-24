import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  compareReferenceDecimal,validateReferenceRangeDecimals,
  parseReferenceIntervalEffectiveFrom,
} from "../src/lib/reference-interval-draft-decimals.ts";

const valid=()=>({
  ageFrom:"0.000",ageTo:"110.000",
  gestationalAgeFromWeeks:"1.00",gestationalAgeToWeeks:"42.00",
  lowValue:"0.000001",highValue:"999999999999.999999",
  criticalLow:"-999999999999.999999",criticalHigh:"999999999999.999999",
});
const denied=(v:unknown,error:string)=>{
  assert.deepEqual(validateReferenceRangeDecimals(v),{ok:false,error});
};

test("F8 clinical: exact MySQL DECIMAL(18,6) clinical limits retain 12-digit integer and micro precision",()=>{
  const result=validateReferenceRangeDecimals(valid());
  assert.equal(result.ok,true);
  if(!result.ok)return;
  assert.deepEqual(result.values,valid());
  assert.equal(compareReferenceDecimal("999999999999.000001","999999999999.000002"),-1);
  assert.equal(compareReferenceDecimal("-999999999999.000002","-999999999999.000001"),-1);
  assert.equal(compareReferenceDecimal("-0.000000","0.000000"),0);
});

test("F8 clinical: JS Number precision collapse must not let reversed normal/critical bounds be staged",()=>{
  assert.equal(Number("999999999999.000002"),Number("999999999999.000001"),
    "regression demonstrates why Number comparisons are clinically unsafe");
  denied({...valid(),lowValue:"999999999999.000002",
    highValue:"999999999999.000001"},"invalid_range");
  denied({...valid(),criticalLow:"999999999999.000002",
    criticalHigh:"999999999999.000001"},"invalid_critical_range");
  denied({...valid(),criticalLow:"-999999999999.000001",
    criticalHigh:"-999999999999.000002"},"invalid_critical_range");
  assert.equal(validateReferenceRangeDecimals({...valid(),
    lowValue:"-999999999999.999999",highValue:"999999999999.999999"}).ok,true);
});

test("F8 clinical: age/gestational intervals are nonnegative exact schema precision with no rounding",()=>{
  const v=validateReferenceRangeDecimals({
    ageFrom:"1",ageTo:"9999999.999",
    gestationalAgeFromWeeks:"0.01",gestationalAgeToWeeks:"9999.99",
  });
  assert.equal(v.ok,true);
  if(v.ok) {
    assert.equal(v.values.ageFrom,"1.000");
    assert.equal(v.values.ageTo,"9999999.999");
    assert.equal(v.values.gestationalAgeFromWeeks,"0.01");
    assert.equal(v.values.gestationalAgeToWeeks,"9999.99");
  }
  denied({...valid(),ageFrom:"110.001",ageTo:"110.000"},"invalid_age_range");
  denied({...valid(),gestationalAgeFromWeeks:"42.01",
    gestationalAgeToWeeks:"42.00"},"invalid_gestational_age_range");
});

test("F8 clinical: out-of-schema precision and scales fail closed without implicit MySQL clipping",()=>{
  for(const [key,value] of [
    ["ageFrom","10000000.000"],["ageTo","1.0001"],["ageTo","-1"],
    ["gestationalAgeFromWeeks","10000.00"],["gestationalAgeToWeeks","1.001"],
    ["lowValue","1000000000000.000000"],["highValue","1.0000001"],
    ["criticalLow","-1000000000000.000000"],["criticalHigh","0.0000001"],
  ] as const) denied({...valid(),[key]:value},"invalid_numeric_value");
});

test("F8 clinical: reject JSON numbers, scientific notation, NaN, Infinity, punctuation and negative age",()=>{
  for(const value of [1,0.000001,Number.MAX_SAFE_INTEGER,Infinity,NaN,
    "1e-6","1E6","NaN","Infinity","1,000.000","- 1","+1","01","1.","-0.000001"]) {
    denied({...valid(),lowValue:value},"invalid_numeric_value");
  }
  denied({...valid(),ageFrom:"-0.001"},"invalid_numeric_value");
  denied({...valid(),gestationalAgeFromWeeks:-1},"invalid_numeric_value");
  denied(null,"invalid_numeric_value");
  denied([],"invalid_numeric_value");
});

test("F8 clinical: omitted optional values remain null; no fabricated clinical threshold",()=>{
  const result=validateReferenceRangeDecimals({});
  assert.equal(result.ok,true);
  if(result.ok) {
    for(const v of Object.values(result.values))assert.equal(v,null);
  }
  const optional=validateReferenceRangeDecimals({
    lowValue:"",highValue:null,ageFrom:undefined,criticalLow:null,
  });
  assert.equal(optional.ok,true);
});

test("F8 clinical: strict ISO effective dates reject rollover and timezone ambiguity",()=>{
  assert.equal(parseReferenceIntervalEffectiveFrom("2028-02-29")?.toISOString(),
    "2028-02-29T00:00:00.000Z");
  assert.equal(parseReferenceIntervalEffectiveFrom("2026-10-24T08:15:11.235Z")?.toISOString(),
    "2026-10-24T08:15:11.235Z");
  assert.equal(parseReferenceIntervalEffectiveFrom("2026-10-24T08:15:11Z")?.toISOString(),
    "2026-10-24T08:15:11.000Z");
  for(const date of ["2026-02-30","2026-02-29","2026-13-01",
    "2026-10-24T24:00:00Z","2026-10-24T12:00",
    "2026-10-24T00:00:00+04:00","2026-10-24Z","not-a-date",123]) {
    assert.equal(parseReferenceIntervalEffectiveFrom(date),null,String(date));
  }
  assert.ok(parseReferenceIntervalEffectiveFrom(undefined) instanceof Date);
});

test("F8 clinical: route uses exact admission and never truncates clinical identity or policy text",()=>{
  const route=readFileSync("src/app/api/catalog/reference-intervals/route.ts","utf8");
  const schema=readFileSync("prisma/schema.prisma","utf8");
  assert.ok(route.includes("validateReferenceRangeDecimals(body)"));
  assert.ok(route.includes("parseReferenceIntervalEffectiveFrom(body.effectiveFrom)"));
  assert.ok(route.includes("canAccessBranch(session, branchId)"));
  assert.ok(route.includes('status: "INACTIVE"'));
  assert.ok(route.includes('approvalStatus: "DRAFT"'));
  assert.ok(route.includes("tx.auditEvent.create"));
  assert.ok(!route.includes("Number(lowValue)"));
  assert.ok(!route.includes("Number(criticalLow)"));
  assert.ok(!route.includes(".slice(0, 36)"));
  assert.ok(!route.includes("body.populationCode.slice(0, 80)"));
  assert.ok(!route.includes("body.reason.trim().slice(0, 1000)"));
  for(const expected of [
    /ageFrom\s+Decimal\?\s+@map\("age_from"\) @db.Decimal\(10, 3\)/,
    /gestationalAgeFromWeeks\s+Decimal\?\s+@map\("gestational_age_from_weeks"\) @db.Decimal\(6, 2\)/,
    /lowValue\s+Decimal\?\s+@map\("low_value"\) @db.Decimal\(18, 6\)/,
    /criticalHigh\s+Decimal\?\s+@map\("critical_high"\) @db.Decimal\(18, 6\)/,
  ])assert.match(schema,expected);
});
