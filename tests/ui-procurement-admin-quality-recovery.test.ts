import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (name: string) => readFileSync("src/components/" + name + ".tsx", "utf8");
const count = (body: string, regex: RegExp) => (body.match(regex) || []).length;

test("Issue #265: purchase request and order submissions do not duplicate or reset detached React forms", () => {
  const ui = source("procurement-manager");
  assert.equal(count(ui, /const formElement = event\.currentTarget;/g), 2);
  assert.equal(count(ui, /formElement\.reset\(\)/g), 2);
  assert.doesNotMatch(ui, /event\.currentTarget\.reset\(\)/);
  assert.match(ui, /if \(submitting\.current\) return false;/);
  assert.match(ui, /finally \{\s*submitting\.current = false;\s*setBusy\(""\);/);
  assert.match(ui, /purchase request or order number before creating another/);
  assert.match(ui, /if \(!submitting\.current\) setUiEditor\(""\)/);
  assert.match(ui, /role=\{isError \? "alert" : "status"\}/);
  assert.match(ui, /\/api\/inventory\/purchase-requests/);
  assert.match(ui, /\/api\/inventory\/purchase-orders/);
});

test("Issue #265: role creation and branch-security permission changes retain review on uncertain network state", () => {
  const ui = source("role-management");
  assert.match(ui, /const inFlight = useRef\(false\)/);
  assert.match(ui, /const formElement = event\.currentTarget;/);
  assert.match(ui, /formElement\.reset\(\)/);
  assert.doesNotMatch(ui, /event\.currentTarget\.reset\(\)/);
  assert.equal(count(ui, /inFlight\.current = false;/g), 3);
  assert.match(ui, /if \(!editing \|\| editing\.isSystem \|\| inFlight\.current\) return;/);
  assert.match(ui, /if \(!role \|\| role\.isSystem \|\| inFlight\.current\) return;/);
  assert.match(ui, /latest\.isSystem/);
  assert.match(ui, /latest\.status !== role\.status/);
  assert.match(ui, /onSubmit=\{confirmRoleStatus\}/);
  assert.match(ui, /if \(!inFlight\.current\) setEditing\(null\)/);
  assert.match(ui, /protectedFinancialPermission && currentlyGranted && <input type="hidden"/);
  assert.match(ui, /role=\{isError \? "alert" : "status"\}/);
});

test("Issue #265: staff accounts, branch grants and password resets have one synchronous in-flight guard", () => {
  const ui = source("user-management");
  assert.match(ui, /const inFlight = useRef\(false\)/);
  assert.match(ui, /const formElement = event\.currentTarget;/);
  assert.match(ui, /formElement\.reset\(\)/);
  assert.doesNotMatch(ui, /event\.currentTarget\.reset\(\)/);
  assert.match(ui, /if \(!editing \|\| inFlight\.current\) return;/);
  assert.match(ui, /if \(inFlight\.current \|\| !resetting \|\| !canResetPasswords/);
  assert.equal(count(ui, /inFlight\.current = false;/g), 4);
  assert.match(ui, /roleIds: form\.getAll\("roleIds"\)/);
  assert.match(ui, /branchIds: form\.getAll\("branchIds"\)/);
  assert.match(ui, /departmentIds: form\.getAll\("departmentIds"\)/);
  assert.match(ui, /prior sessions revoked/);
  assert.match(ui, /Connection interrupted\. Reload staff status/);
});

test("Issue #265: eight QMS creation handlers preserve user-entered fields on disconnect", () => {
  const ui = source("quality-management-console");
  assert.equal(count(ui, /const formElement = event\.currentTarget;/g), 8);
  assert.equal(count(ui, /formElement\.reset\(\)/g), 8);
  assert.doesNotMatch(ui, /event\.currentTarget\.reset\(\)/);
  assert.match(ui, /if \(submitting\.current\) return false;/);
  assert.match(ui, /submitting\.current = false;/);
  assert.match(ui, /if \(!submitting\.current && !busy\) setUiEditor\(""\)/);
  assert.match(ui, /Review the latest audited state before retrying/);
  for (const url of ["/api/quality/nonconformances", "/api/quality/capas",
    "/api/quality/documents", "/api/quality/training", "/api/quality/competency",
    "/api/quality/analyzer-authorizations", "/api/quality/indicators", "/api/quality/audits"]) {
    assert.ok(ui.includes(url), url);
  }
});

test("Issue #265: QC and qualitative option effective dates are explicitly chosen by reviewer", () => {
  const targets = [
    source("qc-manager"),
    source("qualitative-result-options-manager"),
  ];
  for (const ui of targets) {
    assert.match(ui, /name="effectiveFrom"/);
    assert.match(ui, /Effective from \(choose intended local date\)/);
    assert.doesNotMatch(ui, /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/);
  }
  assert.match(targets[0], /<SystemDateField name="effectiveFrom" required/);
  assert.match(targets[1], /<SystemDateField name="effectiveFrom" required/);
  const qms = source("quality-management-console");
  assert.match(qms, /Assigned at \(local date\)/);
  assert.match(qms, /Assessed at \(local date\)/);
  assert.match(qms, /<SystemDateField name="assignedAt" required/);
  assert.match(qms, /<SystemDateField name="assessedAt" required/);
  assert.doesNotMatch(qms, /defaultValue=\{new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)\}/);
});

test("Issue #265: QC target and run forms keep selected analyzer/test until the server confirms success", () => {
  const ui = source("qc-manager");
  assert.match(ui, /const submitting = useRef\(false\)/);
  assert.match(ui, /if \(submitting\.current\) return false;/);
  assert.equal(count(ui, /const formElement = event\.currentTarget;/g), 4);
  assert.equal(count(ui, /, formElement\);/g), 4);
  assert.match(ui, /const ok = await submit\("\/api\/qc\/targets"/);
  assert.match(ui, /if \(ok\) setTargetTestId\(""\)/);
  assert.match(ui, /const ok = await submit\("\/api\/qc\/runs"/);
  assert.match(ui, /if \(ok\) setRunAnalyzerId\(""\)/);
  assert.match(ui, /if \(!resolutionId \|\| !canResolve \|\| submitting\.current\) return;/);
  assert.match(ui, /role=\{isError \? "alert" : "status"\}/);
  assert.match(ui, /finally \{\s*submitting\.current = false;\s*setBusy\(""\);/);
});

test("Issue #265: qualitative draft approval cannot race duplicate clinical transitions", () => {
  const ui = source("qualitative-result-options-manager");
  assert.match(ui, /const submitting = useRef\(false\)/);
  assert.equal(count(ui, /submitting\.current = true;/g), 2);
  assert.equal(count(ui, /submitting\.current = false;/g), 2);
  assert.match(ui, /if \(!governance \|\| !canApprove \|\| submitting\.current\) return;/);
  assert.match(ui, /if \(!canApprove \|\| busy \|\| submitting\.current\) return;/);
  assert.match(ui, /if \(!busy && !submitting\.current\) setGovernance\(null\)/);
  assert.match(ui, /approvalStatus !== "DRAFT"/);
});
