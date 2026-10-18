import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizedStagedPrices, stagedPriceListCode,
} from "../src/lib/catalog-import-disclosure.ts";

test("financial staging review fails closed without branch coverage and mapped list identity", () => {
  const rows = [{priceListCode:" GLOBAL "}, {priceListCode:"A"}];
  const lists = [{code:"GLOBAL",branchId:null,scopeType:"ORGANIZATION"},{code:"A",branchId:"branch-a",scopeType:"BRANCH"}];
  assert.equal(stagedPriceListCode(rows[0]),"GLOBAL");
  assert.equal(authorizedStagedPrices(rows,lists,new Set(["branch-a"])),true);
  assert.equal(authorizedStagedPrices(rows,lists,new Set(["branch-b"])),false);
  assert.equal(authorizedStagedPrices(rows,lists,new Set()),false);
  assert.equal(authorizedStagedPrices([...rows,{priceListCode:"OTHER"}],lists,new Set(["branch-a"])),false);
  assert.equal(authorizedStagedPrices([...rows,{}],lists,new Set(["branch-a"])),false);
  assert.equal(authorizedStagedPrices([null],lists,new Set(["branch-a"])),false);
  assert.equal(authorizedStagedPrices([{priceListCode:"A"}],[{code:"A",branchId:"branch-b",scopeType:"BRANCH"}],new Set(["branch-a"])),false);
});

test("catalog batch page checks finance and branch scope before loading any monetary summaries or rows", () => {
  const source = readFileSync("src/app/catalog/imports/[id]/page.tsx","utf8");
  assert.match(source,/requirePermission\("catalog\.manage"\)/);
  assert.match(source,/permissionSet\(session\)/);
  assert.match(source,/permissions\.has\("pricing\.manage"\)/);
  assert.match(source,/authorizedStagedPrices\(/);
  assert.match(source,/branch\.status === "ACTIVE"/);
  assert.match(source,/organizationId: session\.user\.organizationId/);
  assert.ok(source.indexOf("authorizedStagedPrices(") < source.indexOf("const [groups, issueRows, rows, totalRows]"));
});
test("price recon never echoes financial candidate data on unresolved scope", () => {
  const s = readFileSync("src/app/api/catalog/imports/[id]/prices/reconcile/route.ts","utf8");
  assert.match(s,/!listIndex\.has\(candidate\.priceListCode\)/);
  assert.match(s,/PRICE_LIST_SCOPE_UNRESOLVED/);
  assert.match(s,/unitPrice: ""/);
  assert.match(s,/stagedIssues: \[\]/);
  assert.match(s,/organizationId, code: \{ in: listCodes \}/);
});
test("catalog-only staff cannot stage financial JSON or see package price/price batch listing", () => {
  const json = readFileSync("src/app/api/catalog/imports/route.ts","utf8");
  const page = readFileSync("src/app/catalog/page.tsx","utf8");
  assert.match(json,/permissionSet\(session\)\.has\("pricing\.manage"\)/);
  assert.match(json,/row\.entityType\.startsWith\("PRICE_"\)/);
  assert.match(json,/needsPricing:payload\.rows!\.some/);
  assert.match(page,/canReviewPrices = permissions\.has\("catalog\.manage"\) && permissions\.has\("pricing\.manage"\)/);
  assert.match(page,/scopeType: \{ in: \["ORGANIZATION", "BRANCH"\] \}/);
  assert.match(page,/branchId: \{ in: activeBranches \}/);
  const visibility = readFileSync("src/lib/catalog-import-pagination.ts","utf8");
  assert.match(page,/catalogImportVisibilityWhere\(\{/);
  assert.match(visibility,/rows: \{ none: \{ entityType: "PRICE_LIST_ITEM" \} \}/);
  assert.match(page,/tx\.catalogImportBatch\.count\(\{ where: importWhere \}\)/);
  assert.match(page,/where: importWhere,/);
});
