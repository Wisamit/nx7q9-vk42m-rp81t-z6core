import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file: string) => readFileSync(`src/components/${file}.tsx`, "utf8");
const count = (text: string, pattern: RegExp) => (text.match(pattern) || []).length;

test("client, referrer and source dialogs recover from rejected requests without false success", () => {
  const text = source("client-referrer-forms");
  assert.equal(count(text, /const formElement = event\.currentTarget;/g), 3);
  assert.equal(count(text, /formElement\.reset\(\);/g), 3);
  assert.equal(count(text, /if \(submitting\.current\) return;/g), 3);
  assert.equal(count(text, /submitting\.current = false;/g), 3);
  assert.equal(count(text, /set(?:Client|Referrer|Source)Error\(true\)/g), 6);
  assert.equal(count(text, /!submitting\.current\) setOpen\(""/g), 3);
  assert.ok(text.includes("clientError ? \"form-error\" : \"form-success\""));
  assert.ok(text.includes("referrerError ? \"form-error\" : \"form-success\""));
  assert.ok(text.includes("sourceError ? \"form-error\" : \"form-success\""));
  assert.doesNotMatch(text, /event\.currentTarget\.reset\(\)/);
  assert.doesNotMatch(text, /<label dir="rtl">الاسم بالعربية/);
});

test("payment retry retains the same posting key on uncertain response and resets a captured form", () => {
  const text = source("payment-form");
  assert.match(text, /if \(submitting\.current\) return;/);
  assert.match(text, /const formElement = event\.currentTarget;/);
  assert.match(text, /postingAttempt\.current\.payload !== payload/);
  assert.match(text, /postingKey: postingAttempt\.current\.key/);
  assert.match(text, /postingAttempt\.current = null;/);
  assert.match(text, /formElement\.reset\(\)/);
  assert.match(text, /finally \{\s*submitting\.current = false;\s*setBusy\(false\);/);
  assert.doesNotMatch(text, /event\.currentTarget\.reset\(\)/);
});

test("notification actions always release busy state on failed network operations", () => {
  const text = source("notification-center-actions");
  assert.equal(count(text, /if \(submitting\.current\) return;/g), 4);
  assert.equal(count(text, /submitting\.current = false;/g), 4);
  assert.equal(count(text, /\} catch \{/g), 4);
  assert.equal(count(text, /\} finally \{/g), 4);
  assert.match(text, /const formElement = event\.currentTarget;/);
  assert.ok(text.includes('formElement.reset();\n      setUiEditor("");'));
  assert.doesNotMatch(text, /event\.currentTarget\.reset\(\)/);
});

test("order creation never reuses a lost React currentTarget after request completion", () => {
  const text = source("order-create-form");
  assert.match(text, /const formElement = event\.currentTarget;/);
  assert.match(text, /if \(submitting\.current \|\| ambiguousSubmissionRef\.current\) return;/);
  assert.match(text, /formElement\.reset\(\)/);
  assert.match(text, /Connection interrupted; the order and invoice may already exist/);
  assert.match(text, /ambiguousSubmissionRef\.current = true;/);
  assert.match(text, /finally \{\s*submitting\.current = false;\s*setBusy\(false\);/);
  assert.doesNotMatch(text, /event\.currentTarget\.reset\(\)/);
});

test("portal booking uses a compact, guarded request dialog with explicit uncertain-result feedback", () => {
  const text = source("portal-booking-form");
  assert.match(text, /<CrudModal open=\{open\}/);
  assert.match(text, /size="compact"/);
  assert.match(text, /if \(submitting\.current \|\| uncertain\.current \|\| requiresReconciliation\) return;/);
  assert.match(text, /const formElement = event\.currentTarget;/);
  assert.match(text, /parseSystemLocalDateTime\(rawStart\)/);
  assert.match(text, /scheduledStartLocal: rawStart/);
  assert.match(text, /requestPortalBooking\(\{/);
  assert.match(text, /Booking status is unknown/);
  assert.match(text, /uncertain\.current = true/);
  assert.match(text, /setRequiresReconciliation\(true\)/);
  assert.doesNotMatch(text, /new Date\(rawStart\)/);
  assert.match(text, /formElement\.reset\(\)/);
  assert.match(text, /finally \{\s*submitting\.current = false;\s*setBusy\(false\);/);
  assert.doesNotMatch(text, /event\.currentTarget\.reset\(\)/);
});
