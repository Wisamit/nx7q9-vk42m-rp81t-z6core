import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

type Route = {
  file: string;
  route: string;
  domain: string;
  directPageForms: number;
  componentForms: number;
  componentModals: number;
  potentialInlineMutations: Array<{ file: string; line: number }>;
  browserReviewStatus: string;
  mobileReviewStatus: string;
  arEnReviewStatus: string;
  roleBranchReviewStatus: string;
};
type Inventory = {
  routeCount: number;
  notice: string;
  routes: Route[];
};

function inventory(): Inventory {
  const output = execFileSync(process.execPath,
    ["scripts/ui-route-form-inventory.mjs", "--json"],
    { encoding: "utf8", maxBuffer: 12 * 1024 * 1024 });
  return JSON.parse(output) as Inventory;
}

test("UI gate #265: every page has a canonical route inventory and no invented browser signoff", () => {
  const manifest = JSON.parse(readFileSync("docs/UI_ROUTE_MANIFEST.json", "utf8")) as {
    expectedRouteCount: number; routes: Array<{ file: string; route: string }>;
  };
  const report = inventory();
  assert.equal(report.routeCount, 81,
    "adding/removing routes requires a conscious update of the end-to-end UI review plan");
  assert.equal(report.routeCount, manifest.expectedRouteCount);
  assert.deepEqual(report.routes.map(row => [row.file, row.route]).sort(),
    manifest.routes.map(row => [row.file, row.route]).sort());
  assert.equal(new Set(report.routes.map(row => row.route)).size, report.routeCount);
  assert.ok(report.notice.includes("not browser or UAT evidence"));
  for (const row of report.routes) {
    assert.ok(row.file.startsWith("src/app/"));
    assert.ok(row.domain);
    assert.equal(row.browserReviewStatus, "NOT_EXECUTED");
    assert.equal(row.mobileReviewStatus, "NOT_EXECUTED");
    assert.equal(row.arEnReviewStatus, "NOT_EXECUTED");
    assert.equal(row.roleBranchReviewStatus, "NOT_EXECUTED");
  }
});

test("UI gate #265: triage records exact source locations and newly modalized admin editors", () => {
  const report = inventory();
  for (const url of [
    "/settings/specimens",
    "/patients/identifier-schemes",
    "/billing/taxes",
  ]) {
    const route = report.routes.find(row => row.route === url);
    assert.ok(route, url + " must be in the inventory");
    assert.ok(route.componentForms >= 1, url + " editor forms must be discoverable");
    assert.ok(route.componentModals >= 1, url + " must use a real modal");
    assert.deepEqual(route.potentialInlineMutations, [],
      url + " must no longer expose direct source-detectable mutation forms");
  }
  assert.ok(report.routes.some(row => row.potentialInlineMutations.length > 0),
    "unreviewed legacy inline forms must remain visible as candidates rather than marked complete");
  for (const row of report.routes) {
    for (const candidate of row.potentialInlineMutations) {
      assert.match(candidate.file, /^src\/(?:app|components)\//);
      assert.ok(candidate.line > 0);
    }
  }
});
