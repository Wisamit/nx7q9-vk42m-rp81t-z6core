import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  buildDeliveryFollowupQueries,parseDeliveryFollowupFilters,deliveryFollowupHref,
} from "../src/lib/report-delivery-followup.ts";

const tenant=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
const now=new Date("2026-10-13T12:00:00.000Z");
function approved(raw:Record<string,string|string[]|undefined>){
  const answer=parseDeliveryFollowupFilters(raw,[branchA,branchB]);
  assert.equal(answer.ok,true);
  if(!answer.ok)throw Error("invalid filter");
  return answer.value;
}
test("Stage 115: handover states are exact, strictly validated, and links preserve branch",()=>{
  for(const status of ["CURRENT_ISSUED_WITH_STAFF_ATTESTATION",
    "CURRENT_ISSUED_NO_STAFF_ATTESTATION"]){
    const f=approved({status,branchId:branchA,accession:"FL-001"});
    assert.equal(f.status,status);
    const q=new URL(deliveryFollowupHref(f,3),"https://lab.example.org");
    assert.equal(q.searchParams.get("status"),status);
    assert.equal(q.searchParams.get("branchId"),branchA);
    assert.equal(q.searchParams.get("accession"),"FL-001");
    assert.equal(q.searchParams.get("page"),"3");
  }
  for(const input of [
    {status:"HANDOVER_DELIVERED"},{status:"PATIENT_ACKNOWLEDGED"},
    {status:["CURRENT_ISSUED_WITH_STAFF_ATTESTATION","ALL"]},
    {branchId:randomUUID()},{branchId:[branchA,branchB]},
    {page:"0"},{accession:"bad\nbarcode"},
  ]){
    assert.equal(parseDeliveryFollowupFilters(input,[branchA,branchB]).ok,false,JSON.stringify(input));
  }
});
test("Stage 115: exact current-version server evidence cannot be spoofed by PRINT or historical versions",()=>{
  for(const status of ["CURRENT_ISSUED_WITH_STAFF_ATTESTATION",
    "CURRENT_ISSUED_NO_STAFF_ATTESTATION"]){
    const filters=approved({status,branchId:branchA,accession:"'; SELECT 1 --",page:"2"});
    const q=buildDeliveryFollowupQueries({
      organizationId:tenant,branchIds:[branchA,branchB],filters,nowUtc:now,
    });
    const expected=[
      /o.organization_id = \?/,
      /o.ordering_branch_id IN \(\?,\?\)/,
      /o.ordering_branch_id = \?/,
      /r.order_id=o.id AND r.organization_id=o.organization_id/,
      /v.report_id=r.id AND v.version=r.current_version/,
      /v.status IN \('FINAL','AMENDED'\)/,
      /d.report_version_id=v.id/,
      /d.channel='OTHER' AND d.status='RECORDED'/,
      /d.recipient='PATIENT'/,
      /d.performed_by_user_id IS NOT NULL/,
      /d.handover_request_id IS NOT NULL/,
      /JSON_UNQUOTE\(JSON_EXTRACT\(d.details,'\$\.evidenceType'\)\)/,
      /STAFF_ATTESTED_IN_PERSON_HANDOVER_V1/,
      /o.status NOT IN \('CANCELLED','DRAFT'\)/,
    ];
    for(const query of [q.count,q.ids]){
      for(const pattern of expected)assert.match(query.sql,pattern);
      assert.ok(query.params.includes(tenant));
      assert.ok(query.params.includes(branchA));
      assert.ok(query.params.includes(branchB));
      assert.ok(query.params.includes("'; SELECT 1 --"));
      assert.doesNotMatch(query.sql,/SELECT 1 --/);
    }
    const isAttested=status.endsWith("WITH_STAFF_ATTESTATION");
    assert.equal(q.count.sql.includes("NOT EXISTS"),!isAttested);
    assert.deepEqual(q.ids.params.slice(0,-2),q.count.params);
    assert.deepEqual(q.ids.params.slice(-2),[50,50]);
    assert.match(q.ids.sql,/AS currentStaffAttested/);
  }
  assert.throws(()=>buildDeliveryFollowupQueries({
    organizationId:tenant,branchIds:[branchB],
    filters:approved({status:"CURRENT_ISSUED_WITH_STAFF_ATTESTATION",branchId:branchA}),
    nowUtc:now,
  }),/BRANCH_FORBIDDEN/);
  assert.throws(()=>buildDeliveryFollowupQueries({
    organizationId:tenant,branchIds:[],filters:approved({status:"ALL"}),nowUtc:now,
  }),/NO_BRANCH_ACCESS/);
});
test("Stage 115: staff evidence never becomes patient receipt or a missing clinical release",()=>{
  const page=readFileSync("src/app/orders/delivery-queue/page.tsx","utf8");
  const query=readFileSync("src/lib/report-delivery-followup.ts","utf8");
  assert.match(page,/requirePermission\("orders.view"\)/);
  assert.match(page,/permissionSet\(session\).has\("reports.view"\)/);
  assert.match(page,/scope.branch.organizationId===organizationId/);
  assert.match(page,/Number\(row.currentStaffAttested\)===1/);
  assert.match(page,/patient receipt not independently verified/);
  assert.match(page,/No in-person staff attestation for current report version/);
  assert.match(page,/Not applicable — no current final\/amended report/);
  assert.match(page,/colSpan=\{8\}/);
  assert.match(query,/AND d.handover_request_id IS NOT NULL/);
  assert.doesNotMatch(query,/d.status='DELIVERED'/);
  assert.match(page,/query.count.sql,\.\.\.query.count.params/);
  assert.match(page,/paged.ids.sql,\.\.\.paged.ids.params/);
  assert.match(page,/page<pages/);
});
