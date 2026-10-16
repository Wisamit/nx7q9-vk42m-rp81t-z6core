import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (name: string) => readFileSync("src/components/" + name + ".tsx", "utf8");
const occurrences = (content: string, expression: RegExp) => (content.match(expression) || []).length;

test("Issue #265: analyzer configuration safely retains forms and one-time secrets", () => {
  const ui = source("analyzer-manager");
  assert.equal(occurrences(ui, /const formElement = event\.currentTarget;/g), 3);
  assert.equal(occurrences(ui, /formElement\.reset\(\)/g), 3);
  assert.doesNotMatch(ui, /event\.currentTarget\.reset\(\)/);
  assert.match(ui, /if \(submitting\.current\) return null;/);
  assert.match(ui, /if \(submitting\.current \|\| issuedToken\) return;/);
  assert.match(ui, /finally \{\s*submitting\.current = false;\s*setBusy\(""\);/);
  assert.match(ui, /setIssuedToken\(""\);\s*\}/);
  assert.match(ui, /onClose=\{closeEditor\}/);
  assert.match(ui, /expiry\?\.toISOString\(\)/);
  assert.match(ui, /Number\.isFinite\(expiry\.getTime\(\)\)/);
  assert.match(ui, /disabled=\{busy !== "" \|\| Boolean\(issuedToken\)\}/);
  assert.match(ui, /Credential issuance is uncertain/);
  assert.match(ui, /server did not return the one-time credential/);
});

test("Issue #265: all reviewed clinical effective dates require an explicit calendar choice", () => {
  const cases: Array<[string, number]> = [
    ["advanced-clinical-rules-manager", 2],
    ["autoverification-validation-manager", 2],
    ["clinical-rules-manager", 1],
    ["critical-escalation-manager", 1],
    ["integration-manager", 1],
    ["analyzer-manager", 1],
  ];
  for (const [name, requiredCount] of cases) {
    const ui = source(name);
    assert.doesNotMatch(ui, /defaultValue=\{new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)\}/,
      name + " cannot silently choose UTC day for effective-dated configuration");
    assert.ok(occurrences(ui, /name="effectiveFrom" type="date" required/g) >= requiredCount,
      name + " must require explicit date selection");
  }
});

test("Issue #265: digital-service mutations release the in-flight guard and preserve form references", () => {
  const ui = source("digital-services-console");
  assert.equal(occurrences(ui, /const formElement = event\.currentTarget;/g), 4);
  assert.equal(occurrences(ui, /formElement\.reset\(\)/g), 4);
  assert.doesNotMatch(ui, /event\.currentTarget\.reset\(\)/);
  assert.match(ui, /if \(submitting\.current\) return false;/);
  assert.match(ui, /finally \{\s*submitting\.current = false;\s*setBusy\(""\);/);
  assert.match(ui, /Number\.isFinite\(startDate\.getTime\(\)\)/);
  assert.match(ui, /scheduledStart: startDate\.toISOString\(\)/);
  assert.match(ui, /\/api\/portal-accounts/);
  assert.match(ui, /\/api\/corporate-portal-access/);
  assert.match(ui, /\/api\/queue/);
});

test("Issue #265: integrations recover from network errors and never silently lose API secrets", () => {
  const ui = source("integration-manager");
  assert.equal(occurrences(ui, /formElement\.reset\(\)/g), 2);
  assert.doesNotMatch(ui, /event\.currentTarget\.reset\(\)/);
  assert.match(ui, /if \(submitting\.current\) return \{ ok: false, body: \{\} \};/);
  assert.match(ui, /finally \{\s*submitting\.current = false;\s*setBusy\(""\);/);
  assert.match(ui, /if \(submitting\.current \|\| secret\) return;/);
  assert.match(ui, /disabled=\{busy !== "" \|\| Boolean\(secret\)\}/);
  assert.match(ui, /No one-time secret was returned/);
  assert.match(ui, /setSecret\(""\); setUiDialog\(""\);/);
});

test("Issue #265: supplier stock receipt retries the same posted draft rather than recreating", () => {
  const ui = source("inventory-manager");
  const post = readFileSync("src/app/api/inventory/receipts/[id]/post/route.ts", "utf8");
  assert.match(ui, /const pendingReceipt = useRef<string \| null>\(null\)/);
  assert.match(ui, /if \(receiptUncertain \|\| pendingReceipt\.current\)/);
  assert.match(ui, /pendingReceipt\.current = id;/);
  assert.match(ui, /await postExistingReceipt\(id\);/);
  assert.match(ui, /postExistingReceipt\(pendingReceiptId\)/);
  assert.match(ui, /\/api\/inventory\/receipts\/\$\{id\}\/post/);
  assert.match(ui, /body\.error === "goods_receipt_not_draft" && body\.status === "POSTED"/);
  assert.match(ui, /if \(result\.uncertain\) \{/);
  assert.match(ui, /setReceiptUncertain\(true\);/);
  assert.match(ui, /if \(receiptForm\.current\?\.isConnected\) receiptForm\.current\.reset\(\)/);
  assert.doesNotMatch(ui, /event\.currentTarget\.reset\(\)/);
  assert.match(post, /goods_receipt_not_draft/);
  assert.match(post, /status: receipt\.status/);
});
