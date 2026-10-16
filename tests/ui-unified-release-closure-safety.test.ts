import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

type Audit = {
  routesInspected: number;
  totalUiComponents: number;
  componentsFoundByRouteGraph: number;
  uniquePotentialInlineForms: number;
  violations: string[];
  coverageStatement: string;
  routes: Array<{
    route: string;
    file: string;
    sourceFileCount: number;
    candidateInlineMutations: Array<{ file: string }>;
    workflows: Record<string, string>;
  }>;
};
const source = (file: string) => readFileSync(file, "utf8");

test("Issue #265: full UI release inventory includes every source route and nested components", () => {
  const report = JSON.parse(execFileSync(process.execPath, [
    "scripts/ui-full-surface-audit.mjs", "--json",
  ], { encoding: "utf8", maxBuffer: 25 * 1024 * 1024 })) as Audit;
  const manifest = JSON.parse(source("docs/UI_ROUTE_MANIFEST.json")) as {
    routes: Array<{route: string; file: string}>;
  };
  assert.equal(report.routesInspected, 81);
  assert.equal(report.routesInspected, manifest.routes.length);
  assert.deepEqual(report.violations, []);
  assert.ok(report.totalUiComponents >= 135);
  assert.ok(report.componentsFoundByRouteGraph > 0);
  assert.ok(report.coverageStatement.includes("NOT been performed"));
  assert.deepEqual(
    report.routes.map(x => [x.file, x.route]).sort(),
    manifest.routes.map(x => [x.file, x.route]).sort(),
  );
  for (const row of report.routes) {
    assert.ok(row.sourceFileCount >= 1);
    assert.equal(row.workflows.actualBrowserReview, "NOT_EXECUTED");
    assert.equal(row.workflows.mobileTabletDesktop, "NOT_EXECUTED");
    assert.equal(row.workflows.arEnRtlLtr, "NOT_EXECUTED");
    assert.equal(row.workflows.organizationTheme, "NOT_EXECUTED");
    assert.equal(row.workflows.timezoneDateTime, "NOT_EXECUTED");
    assert.equal(row.workflows.keyboardScreenReader, "NOT_EXECUTED");
    assert.equal(row.workflows.branchRoleIsolation, "NOT_EXECUTED");
    assert.equal(row.workflows.screenshots, "NOT_CAPTURED");
  }
  assert.ok(report.routes.some(row => row.candidateInlineMutations.length > 0),
    "Incomplete work must remain visible for triage");
});

test("Issue #265: four configuration screens moved into safe modal workflows", () => {
  const specs = [
    ["src/components/critical-escalation-manager.tsx", 1, 1],
    ["src/components/result-validation-policy-manager.tsx", 1, 1],
    ["src/components/qualitative-result-options-manager.tsx", 2, 2],
    ["src/components/organization-structure-manager.tsx", 4, 3],
  ] as const;
  for (const [file, modalCount, formCount] of specs) {
    const contents = source(file);
    assert.equal((contents.match(/<CrudModal\b/g) || []).length, modalCount, file);
    assert.equal((contents.match(/<form\b/g) || []).length, formCount, file);
    assert.ok(contents.includes('size="compact"'), file);
    assert.ok(contents.includes('onClose={() => { if (!busy)') ||
      contents.includes('onClose={()=>{if(!busy)'), file);
  }
  const org = source("src/components/organization-structure-manager.tsx");
  for (const entity of ["branch", "department", "station"]) {
    const title = entity[0].toUpperCase() + entity.slice(1);
    assert.ok(org.includes("set" + title + "EditorOpen(true)"), entity);
    assert.ok(org.includes("open={" + entity + "EditorOpen}"), entity);
  }
  assert.ok(org.includes('operation:"hours",workingHours:hours'),
    "weekly branch working hours must remain updateable");
  assert.ok(org.includes("statusAction&&<section"),
    "status changes must be available in a reasoned confirmation modal");
});

test("Issue #265: governed clinical config keeps draft/audit and reasoned review", () => {
  const critical = source("src/components/critical-escalation-manager.tsx");
  const validation = source("src/components/result-validation-policy-manager.tsx");
  const qualitative = source("src/components/qualitative-result-options-manager.tsx");
  for (const [ui, endpoint, server, action] of [
    [critical, "/api/clinical-rules/critical-escalation",
      "src/app/api/clinical-rules/critical-escalation/route.ts", "CRITICAL_ESCALATION_POLICY_DRAFT_CREATED"],
    [validation, "/api/clinical-rules/validation-policies",
      "src/app/api/clinical-rules/validation-policies/route.ts", "RESULT_VALIDATION_POLICY_DRAFT_CREATED"],
    [qualitative, "/api/clinical-rules/qualitative-options",
      "src/app/api/clinical-rules/qualitative-options/route.ts", "QUALITATIVE_RESULT_OPTION_DRAFT_CREATED"],
  ] as const) {
    assert.ok(ui.includes(endpoint));
    assert.ok(ui.includes('role="alert"'));
    assert.ok(ui.includes("if (!response.ok)"));
    assert.ok(ui.includes("setFormError("));
    assert.ok(ui.includes("router.refresh()"));
    assert.ok(!ui.includes("event.currentTarget.reset()"),
      "failed drafts must not discard user-entered fields");
    const api = source(server);
    assert.ok(api.includes('status: "INACTIVE"') ||
      api.includes('approvalStatus: "DRAFT"'), "must stage inactive governed master data");
    assert.ok(api.includes("auditEvent.create"), "mutations must be audited");
    assert.ok(api.includes(action), "audited event identity must not be lost");
  }
  assert.ok(qualitative.includes('governance.action === "RETIRE"'));
  assert.ok(qualitative.includes("governanceReason"));
  assert.ok(qualitative.includes('body: JSON.stringify({ id: current.id, action: governance.action, reason })'));
  assert.ok(!/\bprompt\(/.test(qualitative));
  assert.ok(!/\bconfirm\(/.test(qualitative));
  const css = source("src/app/globals.css");
  assert.ok(css.includes(".crud-modal-compact .form-grid,"));
  assert.ok(css.includes("height:100dvh"));
  assert.ok(css.includes("outline:2px solid var(--fl-primary)"));
});
