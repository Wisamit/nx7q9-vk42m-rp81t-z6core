import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const manifest = JSON.parse(readFileSync("docs/UI_ROUTE_MANIFEST.json","utf8")) as {
  expectedRouteCount: number;
  routes: Array<{route: string}>;
};
const script = readFileSync("scripts/ui-browser-evidence.mjs","utf8");
const ci = readFileSync(".github/workflows/ci.yml","utf8");
const workflow = readFileSync(".github/workflows/ui-synthetic-browser-review.yml","utf8");

const base = "https://qa.synthetic.example.test";
const storage = () => ({cookies: [], origins: []});
const valid = () => ({
  syntheticDataConfirmed: true,
  routePaths: Object.fromEntries(
    manifest.routes.filter(row => row.route.includes("[")).map(row => [
      row.route, row.route.replace(/\[[^/]+\]/g, "synthetic-id")
    ])
  ),
  profiles: {
    staff_ar: storage(), staff_en: storage(),
    portal_ar: storage(), portal_en: storage(),
  },
});

function preflight(config: ReturnType<typeof valid>, origin = base) {
  return spawnSync(process.execPath, ["scripts/ui-browser-evidence.mjs","--preflight"], {
    encoding: "utf8",
    env: {
      ...process.env,
      FL_UI_AUDIT_STAGING_ORIGIN: origin,
      FL_UI_AUDIT_SYNTHETIC_ONLY: "I_CONFIRM_SYNTHETIC_NONPRODUCTION_DATA",
      FL_UI_AUDIT_CONFIG_JSON: JSON.stringify(config),
    },
  });
}

test("81 canonical paths each produce six synthetic browser cases without browser or screenshot", () => {
  assert.equal(manifest.expectedRouteCount, 81);
  const result = preflight(valid());
  assert.equal(result.status,0, result.stderr);
  assert.match(result.stdout,/486 cases for 81 routes/);
  assert.match(result.stdout,/no browser launched, no screenshots created, no acceptance claimed/);
});

test("dynamic URL fixtures cannot silently point to a dashboard, unrelated route or production path", () => {
  const invalid = valid();
  const target = Object.keys(invalid.routePaths)[0];
  assert.ok(target);
  invalid.routePaths[target] = "/dashboard";
  const result = preflight(invalid);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/fixture does not match canonical route/);
  assert.ok(script.includes("matchingFixturePath(row.route, resolved.pathname)"));
  assert.ok(script.includes("Off-origin fixture mapping is forbidden"));
});

test("browser session cookie and local storage must be isolated to the exact synthetic staging origin", () => {
  const wrongCookie = valid();
  wrongCookie.profiles.staff_ar.cookies.push({domain: "example.com"} as never);
  const r1 = preflight(wrongCookie);
  assert.notEqual(r1.status, 0);
  assert.match(r1.stderr,/cookie domain must match staging host/);

  const wrongLocalStorage = valid();
  wrongLocalStorage.profiles.staff_en.origins.push({origin: "https://production.example.com"} as never);
  const r2 = preflight(wrongLocalStorage);
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr,/localStorage origin must match staging origin/);

  const filenameState = valid();
  (filenameState.profiles.portal_en as unknown) = "/tmp/real-browser-state.json";
  const r3 = preflight(filenameState);
  assert.notEqual(r3.status,0);
  assert.match(r3.stderr,/inline storageState object/);
});

test("the browser evidence runner reports ANY redirected canonical route for independent review", () => {
  assert.ok(script.includes('issues.push("ROUTE_REDIRECTED_REVIEW_REQUIRED")'));
  assert.ok(script.includes('finalUrl.origin !== base'));
  assert.ok(script.includes('issues.push("REDIRECTED_OFF_STAGING_ORIGIN")'));
  assert.ok(script.includes('issues.push("REDIRECTED_TO_LOGIN")'));
  assert.ok(script.includes('visualHumanSignoff:"NOT_EXECUTED"'));
  assert.ok(script.includes('qualifiedClinicalGo:"NO_GO"'));
  assert.ok(script.includes('await page.screenshot('));
  assert.ok(!script.includes('await page.click('));
  assert.ok(!script.includes('await page.fill('));
});

test("public GitHub repo cannot upload UI screenshots or browser session evidence through any workflow", () => {
  assert.ok(ci.includes("github.event.repository.private == true"));
  assert.ok(workflow.includes("workflow_dispatch:"));
  assert.ok(workflow.includes("github.ref == 'refs/heads/main'"));
  assert.ok(workflow.includes("github.event.repository.private == true"));
  assert.ok(workflow.includes("environment: ui-synthetic-staging"));
  assert.ok(workflow.includes("persist-credentials: false"));
  assert.ok(workflow.includes("FL_UI_AUDIT_CONFIG_JSON"));
  assert.ok(workflow.includes("node scripts/ui-browser-evidence.mjs --preflight"));
  assert.ok(workflow.includes("node scripts/ui-browser-evidence.mjs --run"));
  assert.ok(workflow.includes("retention-days: 2"));
  assert.ok(!workflow.includes("pull_request:"));
  assert.ok(!workflow.includes("push:"));
});

test("staging origin validation remains fail-closed regardless of advertised synthetic fixture content", () => {
  for(const origin of ["https://production.example.com","http://qa.example.test","https://example.com"]) {
    const result=preflight(valid(), origin);
    assert.notEqual(result.status,0, origin);
  }
  assert.ok(script.includes('FL_UI_AUDIT_SYNTHETIC_ONLY !== "I_CONFIRM_SYNTHETIC_NONPRODUCTION_DATA"'));
});
