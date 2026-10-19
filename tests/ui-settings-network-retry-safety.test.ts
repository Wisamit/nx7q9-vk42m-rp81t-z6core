import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/system-settings-form.tsx", "utf8");

test("UI #265: organization settings form keeps changes and recovers from network failures", () => {
  assert.ok(source.includes('if (submitting.current) return;'),
    "A synchronous ref must block duplicate submits before React rerenders busy state");
  assert.ok(source.includes('fetch("/api/settings"'));
  assert.ok(source.includes('method: "PUT"'));
  assert.ok(source.includes('body: JSON.stringify(value)'));
  assert.ok(source.includes("try {"));
  assert.ok(source.includes("} catch {"));
  assert.ok(source.includes('setBusy(false);'));
  assert.ok(source.includes("The settings were not confirmed as saved."));
  assert.ok(source.includes("لم يتأكد حفظ الإعدادات"));
  assert.ok(source.includes("window.location.reload()"));
  assert.ok(!source.includes("event.currentTarget.reset()"),
    "Failed settings save must retain user edits");
});

test("UI #265: logo and favicon uploads have real bilingual accessible names", () => {
  assert.ok(source.includes('aria-label={tr("Upload center logo", "رفع شعار المركز")}'));
  assert.ok(source.includes('aria-label={tr("Upload browser icon", "رفع أيقونة المتصفح")}'));
  assert.ok(source.includes('image/png,image/jpeg,image/webp'));
  assert.ok(source.includes('image/png,image/x-icon,image/vnd.microsoft.icon'));
});
