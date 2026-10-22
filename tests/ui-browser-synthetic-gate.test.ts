import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const script = readFileSync("scripts/ui-browser-evidence.mjs", "utf8");
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("Issue #265: source-only gate requires 81 canonical routes with six RTL/LTR responsive scenarios", () => {
  const output = execFileSync(process.execPath,
    ["scripts/ui-browser-evidence.mjs","--validate"],{encoding:"utf8"});
  assert.match(output,/81 canonical routes/);
  assert.match(output,/six bilingual\/responsive scenarios/);
  assert.match(output,/NOT_EXECUTED/);
  for (const viewport of ["desktop","tablet","mobile"]) {
    assert.ok(script.includes(viewport));
  }
  for (const locale of ["ar","en"]) assert.ok(script.includes('locale:"'+locale+'"'));
  assert.ok(script.includes('cases.length !== 486'));
  assert.ok(script.includes('new Set(cases.map(item => item.route)).size !== 81'));
  assert.ok(script.includes("readManifest()"));
  assert.ok(workflow.includes("node scripts/ui-browser-evidence.mjs --validate"));
});

test("Issue #265: synthetic-only evidence runner explicitly rejects real production Hostinger", () => {
  const prohibited = spawnSync(process.execPath,
    ["scripts/ui-browser-evidence.mjs","--run"],
    {encoding:"utf8",env:{
      ...process.env,FL_UI_AUDIT_STAGING_ORIGIN:"https://production.example.com",
      FL_UI_AUDIT_SYNTHETIC_ONLY:"I_CONFIRM_SYNTHETIC_NONPRODUCTION_DATA",
    }});
  assert.notEqual(prohibited.status,0);
  assert.match(prohibited.stderr,/Production or live target is explicitly forbidden/);
  const noAttestation = spawnSync(process.execPath,
    ["scripts/ui-browser-evidence.mjs","--run"],
    {encoding:"utf8",env:{
      ...process.env,FL_UI_AUDIT_STAGING_ORIGIN:"https://qa.example.test",
      FL_UI_AUDIT_SYNTHETIC_ONLY:"",
      FL_UI_AUDIT_CONFIG_JSON:"",
    }});
  assert.notEqual(noAttestation.status,0);
  assert.match(noAttestation.stderr,/Explicit synthetic-only attestation is required/);
  assert.ok(script.includes("Off-origin fixture mapping is forbidden"));
  assert.ok(script.includes("Missing synthetic dynamic-route fixture"));
  assert.ok(script.includes("Do not accidentally print raw fixture secrets"));
});

test("Issue #265: screenshots are never represented as completed clinical, theme or role acceptance", () => {
  for (const line of [
    'visualHumanSignoff:"NOT_EXECUTED"',
    'modalInteractionSignoff:"NOT_EXECUTED"',
    'clinicalSafetySignoff:"NOT_EXECUTED"',
    'themePaletteSignoff:"NOT_EXECUTED"',
    'timezoneDateFormatSignoff:"NOT_EXECUTED"',
    'branchRoleSignoff:"NOT_EXECUTED"',
    'qualifiedClinicalGo:"NO_GO"',
    'ownerAcceptance:"NOT_EXECUTED"',
  ]) assert.ok(script.includes(line), "Missing signoff disclaimer: " + line);
  assert.ok(script.includes("page.goto(target,"));
  assert.ok(!script.includes("page.click("));
  assert.ok(!script.includes("page.fill("));
  assert.ok(script.includes("await page.screenshot("));
  assert.ok(script.includes('schemaVersion:1'));
});

test("Issue #265: visual CI is allowed only on an explicitly labelled trusted internal branch", () => {
  for (const guard of [
    "browser_review:",
    "github.head_ref == 'ui-unified-release-complete-sweep'",
    "github.event.pull_request.head.repo.full_name == github.repository",
    "ui-visual-ready",
    "FL_UI_AUDIT_ENABLE == 'true'",
    "FL_UI_AUDIT_SYNTHETIC_ONLY",
    "FL_UI_AUDIT_STAGING_ORIGIN",
    "secrets.FL_UI_AUDIT_CONFIG_JSON",
    "ui-browser-evidence-synthetic-only",
    "retention-days: 7",
  ]) assert.ok(workflow.includes(guard), "Visual CI policy missing: " + guard);
});

test("Issue #265: screenshot sweeps inspect rendered accessible controls and viewport clipping without patient content", () => {
  for (const field of [
    "renderedFormCount", "renderedActionCount", "visibleDialogCount",
    "unlabeledInputCount", "unlabeledActionCount",
    "interactiveViewportClippingCount",
  ]) assert.ok(script.includes(field), "Browser evidence missing metric " + field);
  for (const finding of [
    "VISIBLE_INPUT_ACCESSIBLE_NAME_MISSING",
    "VISIBLE_ACTION_ACCESSIBLE_NAME_MISSING",
    "INTERACTIVE_CONTROL_CLIPPED",
  ]) assert.ok(script.includes(finding), "Warning category missing: " + finding);
  assert.ok(script.includes("[...(el.labels || [])].some(label => label.textContent?.trim())"),
    "labels must have non-empty accessible text; an empty label node is not valid");
  assert.ok(script.includes('el.closest("label")?.textContent?.trim()'),
    "containing labels must have actual text, not mere DOM presence");
  assert.ok(script.includes('document.querySelectorAll("form").length'));
  assert.ok(script.includes("filter(visible)"));
  assert.ok(script.includes("This is screenshot/smoke") ||
    script.includes("screenshot/smoke"));
  assert.ok(!script.includes("outerHTML"));
  assert.ok(!script.includes("innerHTML"));
  assert.ok(!script.includes("formValues"));
  assert.ok(!script.includes("value: el.value"));
  assert.ok(script.includes('visualHumanSignoff:"NOT_EXECUTED"'));
});
