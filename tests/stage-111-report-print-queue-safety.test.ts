import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  buildReportQueueQueries,parseReportQueueFilters,reportQueueHref,
  reportQueuePatientIdentity,REPORT_QUEUE_PAGE_SIZE,
} from "../src/lib/report-print-queue.ts";

const branchA=randomUUID(),branchB=randomUUID(),org=randomUUID();
function ok(value:ReturnType<typeof parseReportQueueFilters>){
  assert.equal(value.ok,true);
  if(!value.ok)throw Error('Report queue filter parse failed');
  return value.value;
}
test("Stage 111: reject unauthorized branch, duplicate parameters, invalid dates and pathologic pages without widening",()=>{
  for(const input of [
    {branchId:randomUUID()},{branchId:[branchA,branchB]},
    {page:"0"},{page:"1e4"},{page:"-2"},{page:"1;DROP"},
    {page:"123456789"},{status:"WRONG"},{print:"UNSAFE"},
    {from:"2026-02-30"},{to:"2026-13-01"},{from:"2026-10-03",to:"2026-10-02"},
    {accession:"x".repeat(51)},{accession:"CI\nSENSITIVE"},
  ]){
    assert.equal(parseReportQueueFilters(input,[branchA,branchB]).ok,false,JSON.stringify(input));
  }
  const filters=ok(parseReportQueueFilters({
    page:"99999999",branchId:branchA,status:"AMENDED",print:"NO_RECORD",
    from:"2026-10-01",to:"2026-10-13",accession:"  FL-2026-00001  ",
  },[branchA,branchB]));
  assert.equal(filters.page,100000);
  assert.equal(filters.accession,"FL-2026-00001");
  const href=reportQueueHref(filters,4);
  for(const [key,value]of Object.entries({branchId:branchA,status:"AMENDED",
      print:"NO_RECORD",accession:"FL-2026-00001",page:"4"}))
    assert.equal(new URL(href,"https://lab.example.org").searchParams.get(key),value);
  assert.equal(REPORT_QUEUE_PAGE_SIZE,50);
  assert.equal(ok(parseReportQueueFilters({},[branchA])).page,1);
});
test("Stage 111: fixed placeholder SQL always enforces tenant and branch scope with latest-version join",()=>{
  const filters=ok(parseReportQueueFilters({
    page:"2",branchId:branchA,status:"FINAL",print:"NO_RECORD",
    accession:"FL-%_?; --",from:"2026-10-01",to:"2026-10-13",
  },[branchA,branchB]));
  const result=buildReportQueueQueries({
    organizationId:org,authorizedBranchIds:[branchA,branchB],filters,
  });
  for(const statement of [result.count,result.ids]){
    assert.match(statement.sql,/r.organization_id = \?/);
    assert.match(statement.sql,/o.organization_id = \?/);
    assert.match(statement.sql,/o.ordering_branch_id IN \(\?,\?\)/);
    assert.match(statement.sql,/v.version = r.current_version/);
    assert.match(statement.sql,/d.report_version_id = v.id/);
    assert.match(statement.sql,/NOT EXISTS/);
    assert.match(statement.sql,/v.status <> 'RETRACTED'/);
    assert.doesNotMatch(statement.sql,/FL-%|; --/);
    assert.ok(statement.params.includes("FL-%_?; --"));
    assert.ok(statement.params.includes(org));
    assert.ok(statement.params.includes(branchA));
    assert.ok(statement.params.includes(branchB));
    assert.ok(statement.params.includes("2026-10-14 00:00:00.000"));
  }
  assert.equal(result.ids.params.at(-2),50);
  assert.equal(result.ids.params.at(-1),50);
  assert.throws(()=>buildReportQueueQueries({
    organizationId:org,authorizedBranchIds:[branchA],filters:{...filters,branchId:branchB},
  }),/BRANCH_FORBIDDEN/);
  assert.throws(()=>buildReportQueueQueries({
    organizationId:org,authorizedBranchIds:[],filters:{...filters,branchId:""},
  }),/NO_AUTHORIZED_BRANCHES/);
});
test("Stage 111: report queue patient identity derives ONLY from immutable version snapshot",()=>{
  const snapshot={patient:{patientNumber:"HIST-001",fullNameEn:"Original Name",
    fullNameAr:"الاسم التاريخي"},accessionNumber:"A"};
  assert.deepEqual(reportQueuePatientIdentity(snapshot,"en"),{
    patientNumber:"HIST-001",patientName:"Original Name",
  });
  assert.deepEqual(reportQueuePatientIdentity(snapshot,"ar"),{
    patientNumber:"HIST-001",patientName:"الاسم التاريخي",
  });
  assert.deepEqual(reportQueuePatientIdentity({},"en"),{patientNumber:"—",patientName:"—"});
  assert.deepEqual(reportQueuePatientIdentity({patient:{}},"ar"),{patientNumber:"—",patientName:"—"});
});
test("Stage 111: UI uses stable latest-version pointers; never substitute historical or live-patient evidence",()=>{
  const page=readFileSync("src/app/reports/page.tsx","utf8");
  const sql=readFileSync("src/lib/report-print-queue.ts","utf8");
  assert.match(page,/buildReportQueueQueries/);
  assert.match(page,/reportQueuePatientIdentity\(version.contentSnapshot, locale\)/);
  assert.match(page,/versions: \{\s*where: \{ id: \{ in: pointers.map\(row => row.versionId\) \} \}/);
  assert.match(page,/organizationId: session.user.organizationId/);
  assert.match(page,/orderingBranchId: \{ in: authorizedBranchIds \}/);
  assert.match(page,/sql, \.\.\.queries.count.params/);
  assert.match(page,/sql, \.\.\.requestedIds.params/);
  assert.match(page,/page < totalPages/);
  assert.match(page,/Report.*Print Audit Queue/);
  assert.doesNotMatch(page,/report.order.patient./);
  assert.doesNotMatch(sql,/status = 'DELIVERED'.*PRINT/);
});
