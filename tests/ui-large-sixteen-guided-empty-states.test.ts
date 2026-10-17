import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const routes: Array<[string, number]> = [
  ["orders", 1],
  ["billing", 4],
  ["inventory", 3],
  ["notifications", 2],
  ["microbiology", 1],
  ["equipment", 1],
  ["analyzers", 5],
  ["qc", 2],
  ["referrers", 3],
  ["catalog", 2],
  ["integrations", 6],
  ["reports", 1],
  ["worklists", 1],
  ["patients", 1],
  ["billing/reports", 4],
  ["billing/accounts/aging", 2],
];

test("Large UI batch covers sixteen unique canonical routes and exactly 39 guided table states", () => {
  const manifest = JSON.parse(read("docs/UI_ROUTE_MANIFEST.json")) as {
    routes: Array<{ file: string }>;
  };
  const canonical = new Set(manifest.routes.map(row => row.file));
  assert.equal(canonical.size, 81);
  assert.equal(routes.length, 16);
  assert.equal(new Set(routes.map(row => row[0])).size, routes.length);

  let states = 0;
  for (const [route, expectedCount] of routes) {
    const path = `src/app/${route}/page.tsx`;
    assert.ok(canonical.has(path), `${path} is canonical`);
    const source = read(path);
    assert.ok(source.includes('from "@/components/table-empty-state"'), path);
    const count = [...source.matchAll(/<TableEmptyState\b/g)].length;
    assert.equal(count, expectedCount, path);
    // The original colspan and zero-result conditional still govern each table,
    // and all 39 descriptions are explicitly bilingual.
    assert.equal([...source.matchAll(/<td[^>]*className="empty-state"/g)].length, expectedCount, path);
    assert.equal([...source.matchAll(/description=\{tr\(locale,/g)].length, expectedCount, path);
    assert.equal([...source.matchAll(/title=\{tr\(locale,/g)].length, expectedCount, path);
    states += count;
  }
  assert.equal(states, 39);
});

test("Table empty component is presentational only and cannot bypass any permission or query gate", () => {
  const source = read("src/components/table-empty-state.tsx");
  assert.ok(source.includes("export function TableEmptyState"));
  assert.ok(source.includes('role="status"'));
  assert.ok(source.includes('aria-hidden="true"'));
  assert.ok(source.includes("description: string"));
  assert.ok(source.includes("title: string"));
  assert.ok(source.includes("action?: { href: string; label: string }"));
  assert.ok(source.includes("action &&"));
  assert.ok(source.includes("from \"next/link\""));
  assert.doesNotMatch(source, /(?:prisma|fetch\(|requirePermission|useEffect|useState|server action)/);
});

test("Result and financial queue empty guidance never changes reporting or permission rules", () => {
  const checks = [
    ["orders", 'requirePermission("orders.view")'],
    ["billing", 'requirePermission("billing.view")'],
    ["inventory", 'requirePermission("inventory.view")'],
    ["notifications", 'requirePermission("notifications.view")'],
    ["microbiology", 'requirePermission("microbiology.view")'],
    ["equipment", 'requirePermission("equipment.view")'],
    ["analyzers", 'requirePermission("analyzers.view")'],
    ["qc", 'requirePermission("qc.view")'],
    ["referrers", 'requirePermission("referrers.view")'],
    ["catalog", 'requirePermission("catalog.view")'],
    ["integrations", 'requirePermission("integrations.view")'],
    ["reports", 'requirePermission("reports.view")'],
    ["worklists", 'requirePermission("worklists.view")'],
    ["patients", 'requirePermission("patients.view")'],
    ["billing/reports", 'requirePermission("billing.view")'],
    ["billing/accounts/aging", 'requirePermission("billing.view")'],
  ] as const;
  for (const [path, guard] of checks) {
    const source = read(`src/app/${path}/page.tsx`);
    assert.ok(source.includes(guard), `${path}: guard preserved`);
    assert.ok(!source.includes("const emptyData"), "No fabricated records: " + path);
  }
  const reports = read("src/app/reports/page.tsx");
  assert.ok(reports.includes("reportQueuePatientIdentity(version.contentSnapshot"));
  assert.ok(reports.includes("parseReportQueueFilters(await searchParams, authorizedBranchIds)"));
  const worklists = read("src/app/worklists/page.tsx");
  assert.ok(worklists.includes("authorizedDepartmentIds"));
  assert.ok(worklists.includes("branchId: { in: worklistBranchIds }"));
  const aging = read("src/app/billing/accounts/aging/page.tsx");
  assert.ok(aging.includes("hasUnclassified"));
  assert.ok(aging.includes("asOfDate"));
  const finance = read("src/app/billing/reports/page.tsx");
  assert.ok(finance.includes("Amounts are never combined across currencies"));
});

test("Reset actions appear only on existing, permitted list routes, never raw API endpoints", () => {
  const withClear = [
    ["reports", "/reports"], ["worklists", "/worklists"], ["patients", "/patients"],
    ["billing/reports", "/billing/reports"],
    ["billing/accounts/aging", "/billing/accounts/aging"],
  ] as const;
  for (const [route, href] of withClear) {
    const source = read(`src/app/${route}/page.tsx`);
    assert.ok(source.includes(`action={{ href: "${href}"`), route);
    assert.ok(source.includes('label: tr(locale, "Clear filters", "مسح الفلاتر")'), route);
  }
  const component = read("src/components/table-empty-state.tsx");
  assert.ok(component.includes("action.href"));
});

test("New scoped responsive guidance respects existing dark/light CSS tokens, RTL and accessible focus", () => {
  const css = read("src/app/globals.css");
  const marker = "/* Source-audited bilingual empty table states";
  const index = css.indexOf(marker);
  assert.ok(index > -1);
  const rules = css.slice(index);
  assert.ok(rules.includes('td.empty-state:has(> .table-empty-content)'));
  assert.ok(rules.includes(".table-empty-content{"));
  assert.ok(rules.includes(".table-empty-description{"));
  assert.ok(rules.includes(".table-empty-action:focus-visible"));
  assert.ok(rules.includes("@media(max-width:760px)"));
  assert.ok(!rules.includes("text-align:left"), "Text layout must inherit RTL/LTR");
  for (const variable of ["--fl-text", "--fl-muted", "--fl-border", "--fl-surface-soft", "--fl-primary"]) {
    assert.ok(rules.includes(`var(${variable})`), variable);
  }
});
