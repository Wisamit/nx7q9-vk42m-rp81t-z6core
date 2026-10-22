import test from "node:test";
import assert from "node:assert/strict";
import {
  taxLineAmounts,validTaxRate,taxCreditReversal,
  type EffectiveTaxRule,
} from "../src/lib/tax-policy.ts";

type TaxFields=Pick<EffectiveTaxRule,"treatment"|"priceMode"|"ratePercent">;

test("F4 tax: explicit configured inclusive and exclusive rules retain exact DECIMAL(18,4) amounts",()=>{
  const exclusive:TaxFields={treatment:"STANDARD",priceMode:"EXCLUSIVE",ratePercent:"5.00"};
  const inclusive:TaxFields={...exclusive,priceMode:"INCLUSIVE"};
  assert.deepEqual(taxLineAmounts({netAfterDiscount:"100.0000",rule:exclusive}),{
    taxableBase:"100.0000",taxAmount:"5.0000",
    exclusiveTax:"5.0000",lineTotal:"105.0000",
  });
  assert.deepEqual(taxLineAmounts({netAfterDiscount:"100.0000",rule:inclusive}),{
    taxableBase:"95.2381",taxAmount:"4.7619",
    exclusiveTax:"0.0000",lineTotal:"100.0000",
  });
  for(const treatment of ["ZERO_RATED","EXEMPT"] as const) {
    assert.deepEqual(taxLineAmounts({
      netAfterDiscount:"100.0000",
      rule:{...exclusive,treatment,ratePercent:"0.00"},
    }),{
      taxableBase:"100.0000",taxAmount:"0.0000",
      exclusiveTax:"0.0000",lineTotal:"100.0000",
    });
  }
});

test("F4 tax: unknown live policy enum or mode fails closed, never default-exempt/inclusive",()=>{
  const base:TaxFields={treatment:"STANDARD",priceMode:"EXCLUSIVE",ratePercent:"5.00"};
  for(const bad of [
    {...base,treatment:"UNAPPROVED"},
    {...base,treatment:""},
    {...base,priceMode:"UNKNOWN"},
    {...base,priceMode:""},
    {...base,priceMode:null},
    {...base,treatment:null},
  ]) {
    assert.equal(taxLineAmounts({
      netAfterDiscount:"100.0000",rule:bad as TaxFields,
    }),null);
  }
  assert.equal(taxLineAmounts({
    netAfterDiscount:"100.0000",
    rule:{...base,treatment:"ZERO_RATED"},
  }),null,"nonstandard tax treatment cannot silently retain standard rate");
  assert.equal(taxLineAmounts({
    netAfterDiscount:"100.0000",
    rule:{...base,ratePercent:"0.00"},
  }),null,"zero-rate STANDARD requires an explicit different treatment");
});

test("F4 tax: no arbitrary jurisdiction rates, invalid monetary precision or numeric coercion",()=>{
  assert.deepEqual(taxLineAmounts({netAfterDiscount:"0.0000",rule:null}),{
    taxableBase:"0.0000",taxAmount:"0.0000",
    exclusiveTax:"0.0000",lineTotal:"0.0000",
  });
  assert.equal(taxLineAmounts({netAfterDiscount:"100.00001",rule:null}),null);
  assert.equal(taxLineAmounts({netAfterDiscount:"-1.0000",rule:null}),null);
  assert.equal(validTaxRate("100.01"),null);
  assert.equal(validTaxRate("4.999"),null);
  assert.equal(validTaxRate("5.00"),"5.00");
  assert.equal(taxCreditReversal({
    originalGross:"100.0000",originalTax:"5.0000",
    previouslyCreditedGross:"0.0000",previouslyCreditedTax:"0.0000",
    additionalGross:"100.0000",
  })?.taxAmount,"5.0000");
});


test("F4 tax: arithmetic must fit the persisted DECIMAL(18,4), including tax-inclusive/exclusive totals",()=>{
  const standard:TaxFields={
    treatment:"STANDARD",priceMode:"EXCLUSIVE",ratePercent:"5.00",
  };
  assert.equal(taxLineAmounts({
    netAfterDiscount:"99999999999999.9999",rule:standard,
  }),null,"exclusive tax must not overflow invoice money columns");
  assert.equal(taxLineAmounts({
    netAfterDiscount:"100000000000000.0000",rule:null,
  }),null,"a 15-digit integer does not fit DECIMAL(18,4)");
  const inclusive=taxLineAmounts({
    netAfterDiscount:"99999999999999.9999",
    rule:{...standard,priceMode:"INCLUSIVE"},
  });
  assert.equal(inclusive?.lineTotal,"99999999999999.9999");
});

test("F4 tax: a prior credit's tax cannot exceed the associated credited gross",()=>{
  assert.equal(taxCreditReversal({
    originalGross:"100.0000",originalTax:"10.0000",
    previouslyCreditedGross:"1.0000",previouslyCreditedTax:"2.0000",
    additionalGross:"99.0000",
  }),null);
  assert.equal(taxCreditReversal({
    originalGross:"100000000000000.0000",originalTax:"1.0000",
    previouslyCreditedGross:"0.0000",previouslyCreditedTax:"0.0000",
    additionalGross:"1.0000",
  }),null);
});
