import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {
  buildReportQueueQueries,parseReportQueueFilters,reportQueueHref,REPORT_QUEUE_PAGE_SIZE,
} from "../src/lib/report-print-queue.ts";

const page=readFileSync(new URL("../src/app/reports/page.tsx",import.meta.url),"utf8");

test("diagnostic report discovery scopes BOTH count and data by organization and allowed branches",()=>{
  assert.match(page,/requirePermission\("reports.view"\)/);
  assert.match(page,/authorizedBranchIds/);
  assert.match(page,/buildReportQueueQueries\(/);
  assert.match(page,/queries.count.sql, \.\.\.queries.count.params/);
  assert.match(page,/requestedIds.sql, \.\.\.requestedIds.params/);
  assert.match(page,/organizationId: session.user.organizationId/);
  assert.match(page,/orderingBranchId: \{ in: authorizedBranchIds \}/);
  const org=randomUUID(),branch=randomUUID();
  const parsed=parseReportQueueFilters({},[branch]);
  assert.equal(parsed.ok,true);
  if(!parsed.ok)throw Error('Report queue filter parse failed');
  const clauses=buildReportQueueQueries({
    organizationId:org,authorizedBranchIds:[branch],filters:parsed.value,
  });
  assert.match(clauses.count.sql,/r.organization_id = \?/);
  assert.match(clauses.count.sql,/o.organization_id = \?/);
  assert.match(clauses.count.sql,/o.ordering_branch_id IN \(\?\)/);
  assert.match(clauses.ids.sql,/v.version = r.current_version/);
  assert.deepEqual(clauses.count.params,[org,org,branch]);
  assert.deepEqual(clauses.ids.params.slice(0,3),clauses.count.params);
});
test("report discovery retains a bounded, stable multi-page view and valid deep links",()=>{
  assert.equal(REPORT_QUEUE_PAGE_SIZE,50);
  const branch=randomUUID(),parsed=parseReportQueueFilters({page:"3",print:"NO_RECORD"},[branch]);
  assert.equal(parsed.ok,true);
  if(!parsed.ok)throw Error('Report queue filter parse failed');
  const query=buildReportQueueQueries({
    organizationId:randomUUID(),authorizedBranchIds:[branch],filters:parsed.value,
  });
  assert.match(query.ids.sql,/ORDER BY v.issued_at DESC, v.id DESC LIMIT \? OFFSET \?/);
  assert.deepEqual(query.ids.params.slice(-2),[50,100]);
  assert.ok(page.includes("Math.min(filters.page, totalPages)"));
  assert.ok(page.includes('href={"/reports/" + report.orderId}'));
  assert.ok(page.includes("reportQueueHref(filters,page+1)"));
  assert.ok(page.includes("reportQueueHref(filters,page-1)"));
  assert.match(reportQueueHref(parsed.value,4),/page=4/);
  assert.doesNotMatch(page,/take: 200,/);
});
