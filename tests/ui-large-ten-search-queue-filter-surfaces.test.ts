import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const root = "src/app/";
const routes = [
  ["analytics/page.tsx", "filter-bar filter-grid", "analytics.view", ["period", "branchId", "from", "to"]],
  ["billing/accounts/aging/page.tsx", "catalog-form filter-grid", "billing.view", ["branch", "client", "currency", "asOf"]],
  ["billing/reports/page.tsx", "catalog-form filter-grid", "billing.view", ["period", "branchId", "sourceId", "referrerId", "clientId", "testId", "paymentMethodId", "cashierUserId", "currency", "from", "to"]],
  ["orders/delivery-queue/page.tsx", "catalog-form filter-grid", "orders.view", ["branchId", "status", "accession"]],
  ["reports/page.tsx", "catalog-form filter-grid", "reports.view", ["branchId", "status", "print", "accession", "from", "to"]],
  ["quality/eqa/page.tsx", "settings-grid filter-grid", "qc.view", ["branch", "q"]],
  ["patients/page.tsx", "inline-search queue-filters", "patients.view", ["q"]],
  ["phlebotomy/page.tsx", "inline-search queue-filters", "specimens.collect", ["q", "branch"]],
  ["specimens/page.tsx", "inline-search queue-filters", "specimens.view", ["q", "status"]],
  ["worklists/page.tsx", "inline-search queue-filters", "worklists.view", ["q", "branch", "priority", "specimenStatus", "department", "analyzer", "due", "status"]],
] as const;

test("Large release gate: exactly ten established permission-scoped routes use the responsive query pattern", () => {
  assert.equal(routes.length, 10);
  assert.equal(new Set(routes.map(([p]) => p)).size, 10);
  for (const [path, cssClass, permission, controls] of routes) {
    const s = read(root + path);
    assert.ok(s.includes("filter-workspace"), path);
    assert.ok(s.includes(cssClass), path);
    assert.ok(s.includes(`requirePermission("${permission}")`), "permission unchanged: " + path);
    const form = s.slice(s.indexOf("<form "), s.indexOf("</form>", s.indexOf("<form ")));
    for (const name of controls) {
      assert.ok(form.includes(`name="${name}"`), `${path}: original filter ${name} must remain`);
    }
    assert.ok(form.includes('method="get"'), `${path}: read-only filters must use GET`);
    assert.ok(!form.includes('method="post"'), `${path}: must not mutate data`);
  }
});

test("Full-width financial report filters preserve currency isolation, billing date semantics and reset actions", () => {
  const finance = read(root + "billing/reports/page.tsx");
  const aging = read(root + "billing/accounts/aging/page.tsx");
  assert.ok(finance.includes("aggregateFinancialReport"));
  assert.ok(finance.includes("Amounts are never combined across currencies"));
  assert.ok(finance.includes("Payment method and cashier filters affect collection/refund metrics only."));
  assert.ok(finance.includes('href="/billing/reports"'));
  assert.ok(aging.includes('href="/billing/accounts/aging"'));
  assert.ok(aging.includes("hasUnclassified"));
  assert.ok(aging.includes("asOfDate"));
  assert.ok(aging.includes("accessibleScopes"));
  assert.ok(aging.includes('name="asOf"'));
});

test("Operational queues explicitly label all quick filters in both languages", () => {
  const settings = [
    ["patients/page.tsx", ["q"]],
    ["phlebotomy/page.tsx", ["q", "branch"]],
    ["specimens/page.tsx", ["q", "status"]],
    ["worklists/page.tsx", ["q", "branch", "priority", "specimenStatus", "department", "analyzer", "due", "status"]],
  ] as const;
  for (const [path, controls] of settings) {
    const source = read(root + path);
    for (const field of controls) {
      assert.ok(new RegExp(`name="${field}" aria-label=\\{tr\\(locale,`).test(source),
        path + " filter missing bilingual accessible label: " + field);
    }
    assert.ok(source.includes('<button type="submit" className="secondary-button">'));
  }
  assert.ok(read(root + "phlebotomy/page.tsx").includes('href={selectedBranchId ? `/phlebotomy?branch=${selectedBranchId}` : "/phlebotomy"}'));
  assert.ok(read(root + "worklists/page.tsx").includes("authorizedDepartmentIds"));
});

test("Responsive CSS uses existing theme tokens and exposes horizontally scrollable long clinical/financial tables", () => {
  const css = read("src/app/globals.css");
  const start = css.indexOf("/* Search and filter release gate:");
  assert.ok(start > 0);
  const block = css.slice(start);
  for (const selector of [
    ".filter-workspace .filter-grid{display:grid",
    ".filter-workspace .queue-filters{display:grid",
    ".filter-workspace .table-toolbar:has(> .queue-filters)",
    ".filter-workspace .table-wrap{max-width:100%",
    "@media(max-width:1180px)",
    "@media(max-width:760px)",
    ".filter-workspace .filter-grid :is(input,select,textarea):focus-visible",
  ]) assert.ok(block.includes(selector), selector);
  for (const token of ["--fl-text", "--fl-border", "--fl-surface", "--fl-primary"]) {
    assert.ok(block.includes("var(" + token + ")"), token);
  }
  assert.ok(block.includes("overflow-x:auto"));
  assert.ok(block.includes("min-width:max-content"));
});

test("Clinical/result report filters retain authorized branch gates and pagination, without authorizing unscoped reports", () => {
  const reports = read(root + "reports/page.tsx");
  const delivery = read(root + "orders/delivery-queue/page.tsx");
  const worklist = read(root + "worklists/page.tsx");
  assert.ok(reports.includes("parseReportQueueFilters(await searchParams, authorizedBranchIds)"));
  assert.ok(reports.includes("reportQueueHref(filters,page"));
  assert.ok(reports.includes("reportQueuePatientIdentity(version.contentSnapshot"));
  assert.ok(delivery.includes("parseDeliveryFollowupFilters(await searchParams,branchIds)"));
  assert.ok(delivery.includes("deliveryFollowupHref(filters,page"));
  assert.ok(worklist.includes("branchId: { in: worklistBranchIds }"));
  assert.ok(worklist.includes("authorizedDepartmentIds"));
});

test("Reset links are navigation only; queries continue to be evaluated server-side", () => {
  for (const [path, reset] of [
    ["analytics/page.tsx", "/analytics?period=30d"],
    ["billing/reports/page.tsx", "/billing/reports"],
    ["billing/accounts/aging/page.tsx", "/billing/accounts/aging"],
    ["quality/eqa/page.tsx", "/quality/eqa"],
    ["orders/delivery-queue/page.tsx", "/orders/delivery-queue"],
    ["reports/page.tsx", "/reports"],
  ] as const) {
    const source = read(root + path);
    assert.ok(source.includes(`href="${reset}"`), path);
    assert.ok(source.includes('method="get"'), path);
  }
});
