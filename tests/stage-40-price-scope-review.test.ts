import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizedStagedPrices, isGenericPriceReviewScope,
} from "../src/lib/catalog-import-disclosure.ts";

const branches = new Set(["branch-a"]);
const row = (code: string) => ({priceListCode: code, unitPrice: "1000.4500", testCode: "HGB"});

test("Stage 40 generic CSV preview permits only true organization or active branch price lists", () => {
  assert.equal(isGenericPriceReviewScope({scopeType:"ORGANIZATION",branchId:null},branches),true);
  assert.equal(isGenericPriceReviewScope({scopeType:"BRANCH",branchId:"branch-a"},branches),true);
  assert.equal(isGenericPriceReviewScope({scopeType:"BRANCH",branchId:"branch-b"},branches),false);
  assert.equal(isGenericPriceReviewScope({scopeType:"BRANCH",branchId:null},branches),false);
  assert.equal(isGenericPriceReviewScope({scopeType:"ORGANIZATION",branchId:"branch-a"},branches),false);
  for (const type of ["SOURCE","REFERRER","CLIENT","CONTRACT","", "UNKNOWN"]) {
    assert.equal(isGenericPriceReviewScope({scopeType:type,branchId:null},branches),false,type);
    assert.equal(isGenericPriceReviewScope({scopeType:type,branchId:"branch-a"},branches),false,type);
  }
  assert.equal(isGenericPriceReviewScope({scopeType:"ORGANIZATION",branchId:null},new Set()),false);
});

test("Stage 40 financial source candidates cannot inherit an unrelated list's branch-null visibility", () => {
  const lists = [
    {code:"ORG",scopeType:"ORGANIZATION",branchId:null},
    {code:"BRANCH",scopeType:"BRANCH",branchId:"branch-a"},
    {code:"CLIENT",scopeType:"CLIENT",branchId:null},
    {code:"CONTRACT",scopeType:"CONTRACT",branchId:"branch-a"},
    {code:"SOURCE",scopeType:"SOURCE",branchId:null},
    {code:"FOREIGN",scopeType:"BRANCH",branchId:"branch-b"},
  ];
  assert.equal(authorizedStagedPrices([row("ORG"),row("BRANCH")],lists,branches),true);
  for (const code of ["CLIENT","CONTRACT","SOURCE","FOREIGN"]) {
    assert.equal(authorizedStagedPrices([row(code)],lists,branches),false,code);
    assert.equal(authorizedStagedPrices([row("ORG"),row(code)],lists,branches),false,code);
  }
  assert.equal(authorizedStagedPrices([row("ORG")],[{code:"ORG",branchId:null,scopeType:"CLIENT"}],branches),false);
  assert.equal(authorizedStagedPrices([row("ORG")],[{code:"ORG",branchId:null,scopeType:"ORGANIZATION"},{code:"org",branchId:"branch-b",scopeType:"BRANCH"}],branches),false);
  assert.equal(authorizedStagedPrices([row("ORG")],[{code:"ORG",branchId:null,scopeType:"ORGANIZATION"}],new Set()),false);
});

test("Stage 40 server and batch page both require correctly typed price scopes before disclosing staged money", () => {
  const page=readFileSync("src/app/catalog/imports/[id]/page.tsx","utf8");
  const api=readFileSync("src/app/api/catalog/imports/[id]/prices/reconcile/route.ts","utf8");
  assert.match(page,/select: \{ code: true, branchId: true, scopeType: true \}/);
  assert.match(page,/authorizedStagedPrices\(/);
  assert.ok(page.indexOf("authorizedStagedPrices(") < page.indexOf("const [groups, issueRows, rows, totalRows]"));
  assert.match(api,/scopeType: "ORGANIZATION", branchId: null/);
  assert.match(api,/scopeType: "BRANCH", branchId: \{ in: branches \}/);
  assert.doesNotMatch(api,/OR: \[\{ branchId: null \}/);
  assert.match(api,/PRICE_LIST_SCOPE_UNRESOLVED/);
  assert.match(api,/unitPrice: ""/);
  assert.match(api,/approvalRequired: true, liveWrites: false, currencyConversion: false/);
  assert.doesNotMatch(api,/priceListItem\.(create|update)|prisma\.\$transaction/);
});
