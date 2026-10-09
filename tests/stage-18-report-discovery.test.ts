import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/app/reports/page.tsx", import.meta.url), "utf8");

test("diagnostic report discovery is scoped by organization and allowed branches for both count and data", () => {
  assert.ok(page.includes('requirePermission("reports.view")'));
  assert.ok(page.includes("organizationId: session.user.organizationId"));
  assert.ok(page.includes("orderingBranchId: { in: branchIds }"));
  assert.ok(page.includes("prisma.diagnosticReport.count({ where })"));
  assert.ok(page.includes("prisma.diagnosticReport.findMany({\n    where,"));
});
test("report discovery pages are bounded and preserve older report access", () => {
  assert.ok(page.includes("const pageSize = 50"));
  assert.ok(page.includes("Math.min(parsedPage || 1, totalPages)"));
  assert.ok(page.includes("skip: (page - 1) * pageSize"));
  assert.ok(page.includes("take: pageSize"));
  assert.ok(page.includes('href={`/reports?page=${page + 1}`}'));
  assert.ok(page.includes('href={`/reports?page=${page - 1}`}'));
  assert.ok(!page.includes("take: 200,"));
});
