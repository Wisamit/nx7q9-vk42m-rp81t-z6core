import test from "node:test";
import assert from "node:assert/strict";
import { reviewEligibleStagedReferences } from "../src/lib/catalog-review-dependency-graph.ts";

const live = {
  tests: new Set(["VISIBLE_TEST"]), units: new Set<string>(),
  packages: new Set<string>(), priceLists: new Set(["VISIBLE_LIST"]),
};
const draft = (entityType: string, normalized: Record<string, unknown>,
  status: "VALID" | "WARNING" | "ERROR" = "WARNING") =>
  ({ entityType, normalized, status });

test("F8 §87: tariff cannot depend on staged package with a missing clinical test",()=>{
  const staged = reviewEligibleStagedReferences([
    draft("PACKAGE",{code:"NEW_PKG",memberTestCodes:["INVISIBLE_TEST"]}),
    draft("PRICE_LIST_PACKAGE_ITEM",{priceListCode:"VISIBLE_LIST",packageCode:"NEW_PKG"}),
  ],live);
  assert.equal(staged.packages.has("NEW_PKG"),false);
});

test("F8 §87: invalid staged tests cannot satisfy package membership",()=>{
  const staged = reviewEligibleStagedReferences([
    draft("TEST",{code:"NEW_TEST"},"ERROR"),
    draft("PACKAGE",{code:"PKG",memberTestCodes:["VISIBLE_TEST","NEW_TEST"]}),
  ],live);
  assert.equal(staged.packages.has("PKG"),false);
});

test("F8 §87: fully resolvable staged package remains pending only",()=>{
  const staged = reviewEligibleStagedReferences([
    draft("TEST",{code:"new_test"}),
    draft("PACKAGE",{code:"pkg",memberTestCodes:["VISIBLE_TEST","NEW_TEST"]}),
  ],live);
  assert.equal(staged.tests.has("NEW_TEST"),true);
  assert.equal(staged.packages.has("PKG"),true);
  assert.equal(live.packages.has("PKG"),false);
});

test("F8 §87: duplicate staged identities are ambiguous even with pre-existing row error",()=>{
  const staged = reviewEligibleStagedReferences([
    draft("TEST",{code:"NEW_TEST"}),
    draft("TEST",{code:"new_test"},"ERROR"),
    draft("PACKAGE",{code:"PKG",memberTestCodes:["NEW_TEST"]}),
  ],live);
  assert.equal(staged.tests.has("NEW_TEST"),false);
  assert.equal(staged.packages.has("PKG"),false);
});

test("F8 §87: duplicate staged package cannot be a tariff parent",()=>{
  const staged = reviewEligibleStagedReferences([
    draft("PACKAGE",{code:"PKG",memberTestCodes:["VISIBLE_TEST"]}),
    draft("PACKAGE",{code:"pkg",memberTestCodes:["VISIBLE_TEST"]}),
  ],live);
  assert.equal(staged.packages.has("PKG"),false);
});

test("F8 §87: blank, wrong-type and empty package members fail closed",()=>{
  for(const values of [[],[""],null,"VISIBLE_TEST",[123],undefined]){
    const staged = reviewEligibleStagedReferences([
      draft("PACKAGE",{code:"PKG",memberTestCodes:values}),
    ],live);
    assert.equal(staged.packages.has("PKG"),false,String(values));
  }
});

test("F8 §87: unrelated price list and unit master remain review-only",()=>{
  const staged=reviewEligibleStagedReferences([
    draft("PRICE_LIST",{code:"NEW_LIST"}),
    draft("UNIT",{code:"MG"}),
  ],live);
  assert.deepEqual([...staged.priceLists],["NEW_LIST"]);
  assert.deepEqual([...staged.units],["MG"]);
});
