import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CRITICAL_QUEUE_PAGE_SIZE,
  criticalQueueAfterWhere,
  criticalQueueFilter,
  criticalQueuePage,
  decodeCriticalQueueCursor,
  encodeCriticalQueueCursor,
} from "../src/lib/critical-results-queue.ts";

test("Stage 79: scoped keyset cursor round trips, rejects malformed/cross-filter input", () => {
  const sample = {
    id:randomUUID(),
    detectedAt:new Date("2026-10-10T08:00:00.000Z"),
    acknowledgementDueAt:new Date("2026-10-10T08:30:00.000Z"),
  };
  const encoded=encodeCriticalQueueCursor(sample,"all");
  assert.deepEqual(decodeCriticalQueueCursor(encoded,"all"),sample);
  assert.equal(decodeCriticalQueueCursor(encoded,"overdue"),null);
  for(const token of ["", "**", "x".repeat(600), Buffer.from("{}").toString("base64url"),
    Buffer.from(JSON.stringify({v:1,filter:"all",id:"unknown",due:null,detected:"2026"})).toString("base64url")]){
    assert.equal(decodeCriticalQueueCursor(token,"all"),null);
  }
  const withoutPolicy={...sample,acknowledgementDueAt:null};
  const missing=encodeCriticalQueueCursor(withoutPolicy,"all");
  assert.deepEqual(decodeCriticalQueueCursor(missing,"all"),withoutPolicy);
  assert.equal(decodeCriticalQueueCursor(missing,"overdue"),null);
  assert.equal(criticalQueueFilter("overdue"),"overdue");
  assert.equal(criticalQueueFilter("unknown"),"all");
});

test("Stage 79: nullable deadlines use stable complete lexicographic keyset",()=>{
  const dt=new Date("2026-10-10T08:00:00Z");
  const due=new Date("2026-10-10T08:30:00Z");
  const keyed=criticalQueueAfterWhere({id:"R-1",detectedAt:dt,acknowledgementDueAt:due});
  assert.deepEqual(keyed,{OR:[
    {acknowledgementDueAt:{gt:due}},
    {acknowledgementDueAt:due,detectedAt:{gt:dt}},
    {acknowledgementDueAt:due,detectedAt:dt,id:{gt:"R-1"}},
    {acknowledgementDueAt:null},
  ]});
  const nulls=criticalQueueAfterWhere({id:"R-2",detectedAt:dt,acknowledgementDueAt:null});
  assert.deepEqual(nulls,{OR:[
    {acknowledgementDueAt:null,detectedAt:{gt:dt}},
    {acknowledgementDueAt:null,detectedAt:dt,id:{gt:"R-2"}},
  ]});
  assert.deepEqual(criticalQueueAfterWhere(null),{});
});

test("Stage 79: sentinel never appears on screen and last visible event advances page",()=>{
  const rows=Array.from({length:CRITICAL_QUEUE_PAGE_SIZE+1},(_,i)=>({
    id:randomUUID(),detectedAt:new Date(2026,9,10,0,i),
    acknowledgementDueAt:new Date(2026,9,10,1,i),
  }));
  const first=criticalQueuePage(rows,"all");
  assert.equal(first.rows.length,50);
  assert.equal(first.hasNext,true);
  assert.deepEqual(decodeCriticalQueueCursor(first.nextCursor!,"all"),rows[49]);
  assert.notEqual(first.rows.at(-1)?.id,rows[50].id);
  const last=criticalQueuePage(rows.slice(0,3),"all");
  assert.equal(last.nextCursor,null);
  assert.equal(last.hasNext,false);
});

test("Stage 79: live triage always applies organization, active branch, department and due filtering BEFORE keyset",()=>{
  const page=readFileSync("src/app/critical-results/page.tsx","utf8");
  assert.match(page,/requirePermission\("critical\.communicate"\)/);
  assert.match(page,/scope\.branch\.status === "ACTIVE"/);
  assert.match(page,/authorizedDepartmentIds\(session\)/);
  assert.match(page,/status: "OPEN" as const/);
  assert.match(page,/organizationId: session\.user\.organizationId/);
  assert.match(page,/performingBranchId: \{ in: branchIds \}/);
  assert.match(page,/departmentId: \{ in: departmentIds \}/);
  assert.match(page,/criticalQueueAfterWhere\(cursor\)/);
  assert.match(page,/filter === "overdue"/);
  assert.match(page,/acknowledgementDueAt: \{ lte: now \}/);
  assert.match(page,/nulls: "last"/);
  assert.match(page,/detectedAt: "asc"/);
  assert.match(page,/id: "asc"/);
  assert.match(page,/take: CRITICAL_QUEUE_PAGE_SIZE \+ 1/);
  assert.match(page,/isolationLevel: "RepeatableRead"/);
  assert.doesNotMatch(page,/take: 300/);
  assert.match(page,/queue\.hasNext && queue\.nextCursor/);
});
