import test from "node:test";
import assert from "node:assert/strict";
import { validF2ClinicalIntervalNumbers } from "../src/lib/catalog-f2-clinical-values.ts";
const initial={
  ageFrom:null,ageTo:null,gestationalAgeFromWeeks:null,
  gestationalAgeToWeeks:null,lowValue:null,highValue:null,
  criticalLow:null,criticalHigh:null,
};
test("F2: exact decimal lower/upper clinical and population boundaries",()=>{
  assert.equal(validF2ClinicalIntervalNumbers(initial),true);
  assert.equal(validF2ClinicalIntervalNumbers({
    ...initial,ageFrom:"0",ageTo:"120.000",
    gestationalAgeFromWeeks:"10.50",
    gestationalAgeToWeeks:"40.25",
    lowValue:"-0.500000",highValue:"999999999999.999999",
    criticalLow:"-999999999999.999999",
    criticalHigh:"999999999999.999999",
  }),true);
  for(const [key,lower,higher] of [
    ["ageFrom","100.001","100.000"],
    ["gestationalAgeFromWeeks","40.01","40.00"],
    ["lowValue","2.000001","2.000000"],
    ["criticalLow","0.000001","0.000000"],
  ] as const){
    const highKey:Record<typeof key,string>={
      ageFrom:"ageTo",gestationalAgeFromWeeks:"gestationalAgeToWeeks",
      lowValue:"highValue",criticalLow:"criticalHigh",
    } as Record<typeof key,string>;
    assert.equal(validF2ClinicalIntervalNumbers({
      ...initial,[key]:lower,[highKey[key]]:higher,
    }),false,key);
  }
  for(const field of ["ageFrom","ageTo",
    "gestationalAgeFromWeeks","gestationalAgeToWeeks"] as const)
    assert.equal(validF2ClinicalIntervalNumbers({...initial,[field]:"-0.01"}),false,field);
});
test("F2: refuse malformed or overflowing numeric limits without float rounding",()=>{
  for(const value of ["0.0000001","1e6","NaN","Infinity","1.2.3",
    "1000000000000"," 1.0","1,50","--1","01.0",1.5]){
    assert.equal(validF2ClinicalIntervalNumbers({...initial,criticalLow:value}),
      false,String(value));
  }
  assert.equal(validF2ClinicalIntervalNumbers({...initial,ageFrom:"1.1234"}),false);
  assert.equal(validF2ClinicalIntervalNumbers({...initial,gestationalAgeFromWeeks:"1.999"}),false);
  assert.equal(validF2ClinicalIntervalNumbers({...initial,lowValue:undefined}),false);
  assert.equal(validF2ClinicalIntervalNumbers({ageFrom:null}),false);
  assert.equal(validF2ClinicalIntervalNumbers(null),false);
  assert.equal(validF2ClinicalIntervalNumbers([]),false);
});
