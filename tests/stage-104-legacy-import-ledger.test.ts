import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {summarizeImportLedger,summarizeLedgerCollection,type ImportLedgerBatch} from "../src/lib/legacy-import-ledger.ts";
const make=(overrides:Partial<ImportLedgerBatch>={}):ImportLedgerBatch=>({
 id:"b",sourceType:"MDB",sourceName:"Family Lab",sourceChecksum:"abc",
 status:"IMPORTED",createdAt:"2026-10-13T00:00:00.000Z",
 validatedAt:"2026-10-13T01:00:00.000Z",importedAt:"2026-10-13T02:00:00.000Z",
 counts:[{entityType:"TEST",status:"IMPORTED",_count:{_all:4}},
   {entityType:"REFERENCE_INTERVAL",status:"WARNING",_count:{_all:3}},
   {entityType:"PRICE_LIST_ITEM",status:"SKIPPED",_count:{_all:2}}],
 ...overrides,
});
test("Stage 104: imported does not conceal unresolved clinical and financial rows",()=>{
 const x=summarizeImportLedger(make());
 assert.equal(x.imported,4);assert.equal(x.unresolved,3);assert.equal(x.deferred,3);assert.equal(x.skipped,2);
 assert.equal(x.state,"BLOCKED");
 assert.ok(x.findings.some(f=>f.code==="UNRESOLVED_STAGED_ROWS"&&f.severity==="BLOCK"));
 assert.ok(x.findings.some(f=>f.code==="SKIPPED_ROWS_REQUIRE_RECONCILIATION"));
 assert.deepEqual(x.byType.map(t=>t.entityType),["PRICE_LIST_ITEM","REFERENCE_INTERVAL","TEST"]);
});
test("Stage 104: review-only batches never appear clinically released",()=>{
 const x=summarizeImportLedger(make({sourceType:"CONFIG_BUNDLE_REVIEW",status:"VALIDATED"}));
 assert.ok(x.findings.some(f=>f.code==="REVIEW_ONLY_SOURCE_NOT_COMMITTED"));
 assert.notEqual(x.state,"BLOCKED");
});
test("Stage 104: source provenance is not assumed",()=>{
 const x=summarizeImportLedger(make({sourceChecksum:null,validatedAt:null,counts:[]}));
 assert.equal(x.total,0);
 for(const code of ["SOURCE_CHECKSUM_MISSING","NO_SOURCE_ROWS_RECORDED","VALIDATION_TIMESTAMP_MISSING"])
   assert.ok(x.findings.some(f=>f.code===code));
 assert.equal(x.state,"REVIEW_REQUIRED");
});
test("Stage 104: never classify skipped results as imported, and use loaded page totals only",()=>{
 const x=summarizeImportLedger(make({counts:[{entityType:"TEST",status:"SKIPPED",_count:{_all:12}}]}));
 assert.equal(x.imported,0);assert.equal(x.skipped,12);assert.equal(x.state,"REVIEW_REQUIRED");
 const collection=summarizeLedgerCollection([x,summarizeImportLedger(make())]);
 assert.equal(collection.batches,2);
 assert.equal(collection.skipped,14);
 assert.equal(collection.unresolved,3);
});
test("Stage 104: API scoped by tenant, live role and branch with type-based confidentiality",()=>{
 const src=readFileSync("src/app/api/catalog/imports/reconciliation-ledger/route.ts","utf8");
 for(const signal of ["getCurrentSession","catalog.manage","organizationId","branchScopes","pricing.manage",
   "catalog.reference_ranges.manage","createdByUserId:session.userId","sourceType:{notIn:",
   "take:limit+1","summarizeImportLedger","Cache-Control"])assert.ok(src.includes(signal),signal);
 assert.doesNotMatch(src,/sourceData:true|normalizedData:true|validationIssues:true/);
 assert.doesNotMatch(src,/\.delete\(|\.update\(|\.create\(/);
});
