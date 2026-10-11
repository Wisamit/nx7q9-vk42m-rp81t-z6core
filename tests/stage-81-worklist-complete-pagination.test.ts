import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  WORKLIST_PAGE_SIZE, worklistAfterWhere, worklistPage, worklistPageHref,
  decodeWorklistCursor, encodeWorklistCursor, worklistFilterFingerprint,
  type WorklistFilterState,
} from "../src/lib/worklist-pagination.ts";

const base=():WorklistFilterState=>({
  q:"ABC-120",status:"IN_PROGRESS",department:randomUUID(),branch:randomUUID(),
  priority:"STAT",specimenStatus:"RECEIVED",due:"OVERDUE",analyzer:"UNASSIGNED",
});

test("Stage 81: 50+1 sentinel pagination and stable identical createdAt tie-breaking",()=>{
  const filters=base();
  const rows=Array.from({length:51},()=>({id:randomUUID(),createdAt:new Date("2026-10-11T08:00:00.000Z")}))
    .sort((a,b)=>a.id.localeCompare(b.id));
  const page=worklistPage(rows,filters);
  assert.equal(page.rows.length,WORKLIST_PAGE_SIZE);
  assert.equal(page.hasNext,true);
  assert.equal(page.rows.includes(rows[50]),false);
  const decoded=decodeWorklistCursor(page.nextCursor!,filters);
  assert.deepEqual(decoded,rows[49]);
  assert.deepEqual(worklistAfterWhere(decoded),{OR:[
    {createdAt:{gt:rows[49].createdAt}},
    {createdAt:rows[49].createdAt,id:{gt:rows[49].id}},
  ]});
  const final=worklistPage(rows.slice(0,17),filters);
  assert.equal(final.hasNext,false);
  assert.equal(final.nextCursor,null);
  assert.deepEqual(worklistAfterWhere(null),{});
});

test("Stage 81: filters are preserved on links; cursor cannot be reused with changed search, branch, TAT or analyzer",()=>{
  const filters=base();
  const position={id:randomUUID(),createdAt:new Date("2026-10-11T08:00:00.123Z")};
  const token=encodeWorklistCursor(position,filters);
  const url=worklistPageHref(filters,token);
  const parsed=new URL(url,"https://family-lab.example");
  assert.equal(parsed.pathname,"/worklists");
  for(const [key,value] of Object.entries(filters))assert.equal(parsed.searchParams.get(key),value);
  assert.equal(parsed.searchParams.get("after"),token);
  assert.deepEqual(decodeWorklistCursor(token,filters),position);
  assert.equal(worklistPageHref(filters,null).includes("after="),false);
  for(const key of Object.keys(filters) as Array<keyof WorklistFilterState>){
    const changed={...filters,[key]:filters[key]+"_DIFFERENT"};
    assert.notEqual(worklistFilterFingerprint(changed),worklistFilterFingerprint(filters));
    assert.equal(decodeWorklistCursor(token,changed),null,key);
  }
  for(const malformed of ["", "!bad", "A".repeat(600),Buffer.from("{}").toString("base64url"),
    Buffer.from(JSON.stringify({v:1,filter:worklistFilterFingerprint(filters),
      id:randomUUID(),created:"invalid"})).toString("base64url")]){
    assert.equal(decodeWorklistCursor(malformed,filters),null);
  }
});

test("Stage 81: page keeps original full tenant, branch, department, specimen, priority and analyzer rules",()=>{
  const source=readFileSync("src/app/worklists/page.tsx","utf8");
  assert.match(source,/requirePermission\("worklists\.view"\)/);
  assert.match(source,/scope\.branch\.status === "ACTIVE"/);
  assert.match(source,/authorizedDepartmentIds\(session\)/);
  assert.match(source,/scopedWorklistBranchIds\(branchIds, branchId \|\| null\)/);
  assert.match(source,/organizationId: session\.user\.organizationId/);
  assert.match(source,/currentBranchId: \{ in: worklistBranchIds \}/);
  assert.match(source,/status: specimenStatusFilter \|\| \{ in: \["RECEIVED","IN_PROCESS"\] \}/);
  assert.match(source,/priority: priorityFilter/);
  assert.match(source,/test: departmentFilter/);
  assert.match(source,/analyzerRoutes: \{ some: \{ analyzerId: analyzer \} \}/);
  assert.match(source,/andFilters\.push\(worklistAfterWhere\(cursor\)\)/);
  assert.match(source,/orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/);
  assert.match(source,/take: WORKLIST_PAGE_SIZE \+ 1/);
  assert.doesNotMatch(source,/take: 300/);
  assert.match(source,/const visibleItems = worklistWindow\.rows/);
  assert.match(source,/const bulkRows = visibleItems\.flatMap/);
  assert.match(source,/visibleItems\.map\(item =>/);
  assert.match(source,/worklistPageHref\(worklistFilters, worklistWindow\.nextCursor\)/);
  assert.match(source,/Invalid or outdated worklist page marker/);
  assert.match(source,/item\(s\) on this page/);
});
