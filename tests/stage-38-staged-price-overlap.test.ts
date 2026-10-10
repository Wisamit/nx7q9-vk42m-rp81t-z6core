import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stagedPriceOverlapIndex, reconcilePriceCandidate } from "../src/lib/price-import-reconciliation.ts";

const price = (patch: Record<string,string> = {}) => ({
  priceListCode:"PL-A",testCode:"HGB",unitPrice:"14.5000",
  effectiveFrom:"2026-10-01",effectiveTo:"2026-10-31",...patch,
});
const row = (n:number, data: ReturnType<typeof price>, status="WARNING") => ({
  rowNumber:n,status,normalizedData:data,
});
test("price review detects every overlapping staged row, even across source pages", () => {
  const staged=[row(1,price()), row(101,price({effectiveFrom:"2026-10-31",effectiveTo:"2026-11-30"}))];
  const collisions=stagedPriceOverlapIndex(staged);
  assert.deepEqual([...collisions].sort((a,b)=>a-b),[1,101]);
  assert.equal(stagedPriceOverlapIndex(staged.slice(0,1)).size,0);
  const first=price();
  const masters={lists:new Map([["PL-A",{id:"list",status:"ACTIVE",currency:"AED",effectiveFrom:"2026-01-01",effectiveTo:null}]]),
    tests:new Map([["HGB",{id:"test",status:"ACTIVE"}]]),
    existing:new Map<string,Array<{effectiveFrom:string;effectiveTo:string|null}>>()};
  assert.deepEqual(reconcilePriceCandidate(first,masters,collisions.has(1)?2:1).issues,["OVERLAPPING_STAGED_PRICE_WINDOWS"]);
});

test("overlapping identical windows both warn; disjoint and independent identity windows stay clear", () => {
  const a=price(), b=price({effectiveFrom:"2026-11-01",effectiveTo:"2026-11-30"});
  assert.equal(stagedPriceOverlapIndex([row(1,a),row(2,b)]).size,0);
  assert.deepEqual([...stagedPriceOverlapIndex([row(1,a),row(2,a)])].sort((x,y)=>x-y),[1,2]);
  assert.equal(stagedPriceOverlapIndex([row(1,a),row(2,price({testCode:"WBC"})),
    row(3,price({priceListCode:"PL-B"}))]).size,0);
});

test("invalid, processed, and foreign-status rows cannot fabricate staged collisions", () => {
  const a=price(), overlap=price({effectiveFrom:"2026-10-15",effectiveTo:"2026-12-01"});
  for (const status of ["ERROR","IMPORTED","SKIPPED","UNKNOWN"]) {
    assert.equal(stagedPriceOverlapIndex([row(1,a),row(2,overlap,status)]).size,0,status);
  }
  for (const malformed of [
    price({effectiveFrom:"2026-02-30"}), price({effectiveTo:"2026-09-01"}),
    price({effectiveFrom:"bad"}),price({effectiveTo:"today"}),
    price({priceListCode:""}),price({testCode:""}),
  ]) assert.equal(stagedPriceOverlapIndex([row(1,a),row(2,malformed)]).size,0);
  assert.equal(stagedPriceOverlapIndex([row(0,a),row(1,a)]).size,0);
});

test("open-ended effective windows and case-normalized codes are conservatively compared", () => {
  const open=price({effectiveFrom:"2027-01-01",effectiveTo:""});
  const later=price({priceListCode:" pl-a ",testCode:"hgb",effectiveFrom:"2030-01-01",effectiveTo:""});
  assert.deepEqual([...stagedPriceOverlapIndex([row(1,open),row(2,later)])].sort((a,b)=>a-b),[1,2]);
});

test("20k staged rows remain bounded and no quadratic every-row scan is required", () => {
  const data=Array.from({length:20000},(_,i)=>row(i+1,price({
    testCode:"TEST-"+i,effectiveTo:"",effectiveFrom:"2026-01-01",
  })));
  const index=stagedPriceOverlapIndex(data);
  assert.equal(index.size,0);
});

test("price API excludes processed source, requires tenant/finance/branch scopes, and never writes money", () => {
  const s=readFileSync("src/app/api/catalog/imports/[id]/prices/reconcile/route.ts","utf8");
  assert.match(s,/requirePermission\("pricing\.manage"\)/);
  assert.match(s,/permissionSet\(session\)\.has\("catalog\.manage"\)/);
  assert.match(s,/organizationId, code: \{ in: listCodes \}/);
  assert.match(s,/branchId: \{ in: branches \}/);
  assert.match(s,/stagedPriceOverlapIndex\(staged\)/);
  assert.match(s,/stagedCollisions\.has\(row\.rowNumber\)/);
  assert.match(s,/status: \{ in: \["VALID", "WARNING"\] \}/);
  assert.match(s,/take: 20001/);
  assert.match(s,/staged\.length > 20000/);
  assert.match(s,/row\.status !== "VALID" && row\.status !== "WARNING"/);
  assert.match(s,/stagedIssues: \[\], currency: null/);
  assert.match(s,/unitPrice: ""/);
  assert.match(s,/!listIndex\.has\(candidate\.priceListCode\)/);
  assert.match(s,/liveWrites: false/);
  assert.doesNotMatch(s,/priceListItem\.(create|update)|catalogImportRow\.update|prisma\.\$transaction/);
});
