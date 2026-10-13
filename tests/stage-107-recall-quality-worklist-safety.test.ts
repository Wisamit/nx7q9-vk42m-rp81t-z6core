import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

test("Stage 107: recall quality queue is branch, tenant and permission scoped",()=>{
 const page=readFileSync("src/app/inventory/recall-quality/page.tsx","utf8");
 const operations=readFileSync("src/app/inventory/operations/page.tsx","utf8");
 assert.match(page,/requirePermission\("inventory.view"\)/);
 assert.match(page,/quality.nonconformance.manage/);
 assert.match(page,/x.branch.organizationId===org&&x.branch.status/); // known branch-membership scope
 assert.match(page,/organizationId:org,branchId:\{in:permitted\}/);
 assert.match(page,/nonconformance:\{status:/);
 assert.match(page,/orderBy:\[\{createdAt:"desc"\},\{id:"desc"\}\]/);
 assert.match(page,/take:SIZE/);
 assert.match(page,/action:"ESCALATED_TO_QUALITY"/);
 assert.match(page,/safetyStatus:\{in:\["QUARANTINED","RECALLED"\]\}/);
 assert.match(page,/safetyEvents:\{where:\{organizationId:org\}/);
 assert.match(page,/item\.lot\.safetyEvents\[0\]\?\.id===item\.safetyEventId/);
 assert.match(page,/!item\.safetyEvent\.qualityCases\.some/);
 assert.match(page,/take:200/);
 assert.match(page,/pending\.map\(/);
 assert.match(page,/skip:\(page-1\)\*SIZE/);
 assert.match(page,/inventory\/lot-impact/);
 assert.match(operations,/quality.nonconformance.manage/);
 assert.match(operations,/inventory\/recall-quality/);
 const nav=readFileSync("src/components/system-shell.tsx","utf8");
 assert.match(nav,/permissionsAll: \["inventory.view", "quality.nonconformance.manage"\]/);
 assert.doesNotMatch(page,/prisma\.patient|prisma\.laboratoryResult|prisma\.invoice|prisma\.payment/);
 assert.doesNotMatch(page,/\.update\(|\.create\(|\.delete\(/);
 assert.match(page,/التشغيلة/);
});
