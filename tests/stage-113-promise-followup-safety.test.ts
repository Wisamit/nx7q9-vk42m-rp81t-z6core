import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  parseDeliveryFollowupFilters,buildDeliveryFollowupQueries,
  classifyDeliveryPromise,deliveryFollowupHref,DELIVERY_QUEUE_PAGE_SIZE,
} from "../src/lib/report-delivery-followup.ts";

const org=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
const now=new Date("2026-10-13T12:00:00.000Z");
function parsed(raw:Record<string,string|string[]|undefined>={}){
  const result=parseDeliveryFollowupFilters(raw,[branchA,branchB]);
  assert.equal(result.ok,true);
  if(!result.ok)throw Error("filters invalid");
  return result.value;
}
test("Stage 113: fail closed on unauthorized branches, duplicate filters, invalid page and accession",()=>{
  for(const q of [
    {branchId:randomUUID()},{branchId:[branchA,branchB]},
    {status:"READY_TO_EMAIL"},{status:["PENDING","ALL"]},
    {page:"0"},{page:"-1"},{page:"9e4"},{page:"10000000"},
    {accession:"A".repeat(51)},{accession:"A\nB"},
  ]){
    assert.equal(parseDeliveryFollowupFilters(q,[branchA,branchB]).ok,false,JSON.stringify(q));
  }
  assert.equal(parsed().status,"PENDING");
  assert.equal(parsed({page:"9999999"}).page,100000);
  assert.equal(DELIVERY_QUEUE_PAGE_SIZE,50);
  const href=deliveryFollowupHref(parsed({
    branchId:branchA,status:"OVERDUE",accession:"FL-001",page:"2",
  }),3);
  const q=new URL(href,"https://example.com").searchParams;
  assert.equal(q.get("branchId"),branchA);
  assert.equal(q.get("status"),"OVERDUE");
  assert.equal(q.get("accession"),"FL-001");
  assert.equal(q.get("page"),"3");
});
test("Stage 113: fully bound tenant + multi-branch filters and stable pagination",()=>{
  const f=parsed({branchId:branchA,status:"OVERDUE",
    accession:"'; SELECT * FROM patients --",page:"2"});
  const q=buildDeliveryFollowupQueries({
    organizationId:org,branchIds:[branchA,branchB],filters:f,nowUtc:now,
  });
  for(const {sql,params} of [q.ids,q.count]){
    assert.match(sql,/o.organization_id = \?/);
    assert.match(sql,/o.ordering_branch_id IN \(\?,\?\)/);
    assert.match(sql,/o.promised_report_delivery_at_utc IS NOT NULL/);
    assert.match(sql,/o.status NOT IN \('CANCELLED','DRAFT'\)/);
    assert.match(sql,/v.version=r.current_version/);
    assert.match(sql,/v.status NOT IN \('FINAL','AMENDED'\)/);
    assert.match(sql,/o.promised_report_delivery_at_utc < \?/);
    assert.doesNotMatch(sql,/SELECT \* FROM patients/);
    assert.ok(params.includes(org));
    assert.ok(params.includes(branchA));
    assert.ok(params.includes(branchB));
    assert.ok(params.includes("'; SELECT * FROM patients --"));
    assert.ok(params.includes("2026-10-13 12:00:00.000"));
  }
  assert.deepEqual(q.ids.params.slice(-2),[50,50]);
  assert.match(q.ids.sql,/ORDER BY o.promised_report_delivery_at_utc ASC,o.id ASC/);
  assert.deepEqual(q.ids.params.slice(0,-2),q.count.params);
  assert.throws(()=>buildDeliveryFollowupQueries({
    organizationId:org,branchIds:[branchB],filters:f,nowUtc:now,
  }),/BRANCH_FORBIDDEN/);
  assert.throws(()=>buildDeliveryFollowupQueries({
    organizationId:org,branchIds:[],filters:parsed(),nowUtc:now,
  }),/NO_BRANCH_ACCESS/);
});
test("Stage 113: current issued report is NOT delivery; partial/retracted and old final do not satisfy",()=>{
  const date=(s:string)=>new Date(s);
  for(const status of [null,"PARTIAL","RETRACTED"]){
    assert.equal(classifyDeliveryPromise({utc:date("2026-10-13T11:00:00Z"),
      now,currentReportStatus:status}),"OVERDUE");
  }
  assert.equal(classifyDeliveryPromise({utc:date("2026-10-13T12:00:00Z"),
    now,currentReportStatus:null}),"DUE_SOON");
  assert.equal(classifyDeliveryPromise({utc:date("2026-10-14T12:00:00Z"),
    now,currentReportStatus:"PARTIAL"}),"DUE_SOON");
  assert.equal(classifyDeliveryPromise({utc:date("2026-10-14T12:00:01Z"),
    now,currentReportStatus:null}),"FUTURE");
  for(const status of ["FINAL","AMENDED"]){
    assert.equal(classifyDeliveryPromise({utc:date("2026-10-13T11:00:00Z"),
      now,currentReportStatus:status}),"CURRENT_ISSUED");
  }
  const f=parsed({status:"CURRENT_ISSUED"});
  const q=buildDeliveryFollowupQueries({organizationId:org,branchIds:[branchA],filters:f,nowUtc:now});
  assert.match(q.count.sql,/v.status IN \('FINAL','AMENDED'\)/);
});
test("Stage 113: UI prevents cross-branch leakage and never claims printing or patient receipt",()=>{
  const page=readFileSync("src/app/orders/delivery-queue/page.tsx","utf8");
  const orders=readFileSync("src/app/orders/page.tsx","utf8");
  assert.match(page,/requirePermission\("orders.view"\)/);
  assert.match(page,/permissionSet\(session\).has\("reports.view"\)/);
  assert.match(page,/scope.branch.organizationId===organizationId/);
  assert.match(page,/buildDeliveryFollowupQueries/);
  assert.match(page,/paged.ids.sql,\.\.\.paged.ids.params/);
  assert.match(page,/query.count.sql,\.\.\.query.count.params/);
  assert.match(page,/row.promisedLocal/);
  assert.match(page,/row.promisedTimezone/);
  assert.match(page,/row.promisedUtc.toISOString/);
  assert.match(page,/report does not mean printed, sent, received or acknowledged/i);
  assert.match(page,/page<pages/);
  assert.match(orders,/href="\/orders\/delivery-queue"/);
});
