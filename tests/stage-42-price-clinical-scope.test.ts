import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clinicalImportTestWhere, resolveClinicalImportScope,
} from "../src/lib/catalog-clinical-import-scope.ts";
import { stagedPriceTestCode } from "../src/lib/catalog-import-disclosure.ts";
import { parseStagedPriceReviewPage } from "../src/lib/staged-price-review-response.ts";

const base = (activeBranchId: string | null, scopes: string[],
  departments: Array<{id:string;branchId:string|null;status?:string}>) => ({
  organizationId: "lab", activeBranchId,
  activeBranch: activeBranchId
    ? {id:activeBranchId,organizationId:"lab",status:"ACTIVE"} : null,
  branchScopes: scopes.map(branchId=>({branchId,branch:{status:"ACTIVE"}})),
  departmentScopes: departments.map(dept=>({
    departmentId:dept.id,
    department:{status:dept.status??"ACTIVE",organizationId:"lab",branchId:dept.branchId},
  })),
});

const safeCandidate = () => ({
  priceListCode:"",testCode:"",unitPrice:"",effectiveFrom:"",effectiveTo:"",
});
const response = (candidate: ReturnType<typeof safeCandidate>, currency: string|null,
  disposition: string = "BLOCKED") => ({
  rows:[{rowNumber:1,rowStatus:"VALID",candidate,currency,
    disposition,issues:["TEST_SCOPE_UNRESOLVED"]}],
  nextCursor:null,hasMore:false,approvalRequired:true,liveWrites:false,currencyConversion:false,
});

test("Stage 42 rejects inactive/foreign department grants instead of widening price test scope", () => {
  assert.equal(resolveClinicalImportScope(base("branch-a",["branch-a"],
    [{id:"dept-b",branchId:"branch-b"}])),null);
  assert.equal(resolveClinicalImportScope(base("branch-a",["branch-a"],
    [{id:"dept-a",branchId:"branch-a",status:"INACTIVE"}])),null);
  assert.equal(resolveClinicalImportScope(base("branch-b",["branch-a"],[])),null);
  assert.equal(resolveClinicalImportScope(base(null,["branch-a"],[])),null);
  const scope=resolveClinicalImportScope(base("branch-a",["branch-a","branch-b"],
    [{id:"dept-a",branchId:"branch-a"},{id:"dept-b",branchId:"branch-b"}]));
  assert.ok(scope);
  assert.deepEqual(scope.departmentIds,["dept-a"]);
  const where=clinicalImportTestWhere(scope);
  assert.equal(where.organizationId,"lab");
  assert.equal(where.status,"ACTIVE");
  assert.deepEqual(where.departmentId,{in:["dept-a"]});
  assert.match(JSON.stringify(where),/branch-a/);
});

test("Stage 42 price test identity is normalized independently from amounts", () => {
  assert.equal(stagedPriceTestCode({testCode:" hgb ",unitPrice:"5000.1250"}),"HGB");
  assert.equal(stagedPriceTestCode({testCode:10}),"");
  assert.equal(stagedPriceTestCode(null),"");
  assert.equal(stagedPriceTestCode({}),"");
  assert.equal(stagedPriceTestCode(["HGB"]),"");
});

test("Stage 42 client rejects any unredacted financial row for an out-of-scope test", () => {
  assert.equal(parseStagedPriceReviewPage(response(safeCandidate(),null),0).rows[0].currency,null);
  for(const patch of [
    {testCode:"UNAUTHORIZED"}, {unitPrice:"5000.1250"}, {priceListCode:"PRIVATE"},
    {effectiveFrom:"2026-10-01"},{effectiveTo:"2026-10-31"},
  ]){
    assert.throws(()=>parseStagedPriceReviewPage(response({...safeCandidate(),...patch},null),0),
      /unexpected_read_only_price_review_response/);
  }
  assert.throws(()=>parseStagedPriceReviewPage(response(safeCandidate(),"AED"),0));
  assert.throws(()=>parseStagedPriceReviewPage(response(safeCandidate(),null,"READY_FOR_GOVERNANCE"),0));
});

test("Stage 42 price API and batch page authorize clinical scope before reading staged financial source", () => {
  const api=readFileSync("src/app/api/catalog/imports/[id]/prices/reconcile/route.ts","utf8");
  const page=readFileSync("src/app/catalog/imports/[id]/page.tsx","utf8");
  const parser=readFileSync("src/lib/staged-price-review-response.ts","utf8");
  const ui=readFileSync("src/components/price-import-reconciliation.tsx","utf8");
  assert.match(api,/resolveClinicalImportScope\(/);
  assert.match(api,/active_clinical_import_scope_required/);
  assert.ok(api.indexOf("if (!scope)") < api.indexOf("prisma.catalogImportRow.findMany"));
  assert.match(api,/where: \{ \.\.\.clinicalImportTestWhere\(scope\), code: \{ in: testCodes \} \}/);
  assert.doesNotMatch(api,/departments\.length \? \{ departmentId/);
  assert.match(api,/!testIndex\.has\(candidate\.testCode\)/);
  assert.match(api,/TEST_SCOPE_UNRESOLVED/);
  assert.match(api,/unitPrice: ""/);
  assert.match(api,/stagedIssues: \[\], currency: null/);
  assert.match(api,/resolvedPriceListId: null, resolvedTestId: null/);
  assert.match(page,/stagedPriceTestCode\(/);
  assert.match(page,/if \(!priceScope\) notFound\(\)/);
  assert.match(page,/clinicalImportTestWhere\(priceScope\)/);
  assert.match(page,/permittedPriceCodes/);
  assert.ok(page.indexOf("permittedPriceCodes") < page.indexOf("const [groups, issueRows, rows, totalRows]"));
  assert.match(parser,/TEST_SCOPE_UNRESOLVED/);
  assert.match(ui,/TEST_SCOPE_UNRESOLVED/);
  assert.match(api,/approvalRequired: true, liveWrites: false, currencyConversion: false/);
  assert.doesNotMatch(api,/priceListItem\.(create|update)|catalogImportRow\.update|prisma\.\$transaction/);
});
