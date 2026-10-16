import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

test("UI #265: procurement state transitions require a reviewed and busy-guarded dialog", () => {
  const ui = read("src/components/procurement-action-button.tsx");
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('open={open}'));
  assert.ok(ui.includes('onSubmit={run}'));
  assert.ok(ui.includes("confirmText"));
  assert.ok(ui.includes('onClose={() => { if (!busy) setOpen(false); }}'));
  assert.ok(ui.includes('fetch(endpoint, { method: "POST" })'));
  assert.ok(ui.includes("setFormError("));
  assert.ok(ui.includes("catch {"));
  assert.doesNotMatch(ui, /(?:window\.)?(?:confirm|prompt|alert)\s*\(/);
});

test("UI #265: report printing stays blocked if required delivery audit event cannot be recorded", () => {
  const ui = read("src/components/print-report-button.tsx");
  assert.ok(ui.includes('body: JSON.stringify({ channel: "PRINT", status: "RECORDED" })'));
  assert.ok(ui.includes("if (!response?.ok)"));
  assert.ok(ui.includes("setPrintError("));
  assert.ok(ui.includes('role="alert"'));
  assert.ok(ui.indexOf("if (!response?.ok)") < ui.indexOf("window.print()"));
  assert.ok(ui.includes("return;"));
  assert.doesNotMatch(ui, /(?:window\.)?(?:confirm|prompt|alert)\s*\(/);
});
