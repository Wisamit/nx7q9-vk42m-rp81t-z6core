import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const form = readFileSync("src/components/system-settings-form.tsx", "utf8");
const dialog = readFileSync("src/components/system-settings-dialog.tsx", "utf8");
const modal = readFileSync("src/components/crud-modal.tsx", "utf8");

test("UI #265: settings request cannot be double-submitted before React busy render", () => {
  assert.match(form, /const submitting = useRef\(false\)/);
  assert.match(form, /if \(submitting\.current\) return;/);
  assert.match(form, /submitting\.current = true;/);
  assert.match(form, /if \(!acknowledgedSuccess\) \{\s*submitting\.current = false;/);
  assert.match(form, /onSavePendingChange\?\.\(true\)/);
  assert.match(form, /onSavePendingChange\?\.\(false\)/);
});

test("UI #265: saving settings blocks close, Escape, backdrop and discard until save resolves", () => {
  assert.match(dialog, /savingRef\.current = pending/);
  assert.match(dialog, /onClose=\{\(\) => \{ if \(!savingRef\.current\) setOpen\(false\); \}\}/);
  assert.match(dialog, /dismissalBlocked=\{saving\}/);
  assert.match(dialog, /onSavePendingChange=\{onSavePendingChange\}/);
  assert.match(modal, /useEffect\(\(\) => \{ dismissalBlockedRef\.current = dismissalBlocked; \}, \[dismissalBlocked\]\)/);
  assert.match(modal, /if \(dismissalBlockedRef\.current \|\| discardOpenRef\.current\) return;/);
  assert.match(modal, /disabled=\{dismissalBlocked\}/);
  assert.match(modal, /if \(event\.key === "Escape"\)/);
  assert.match(modal, /if \(event\.target === event\.currentTarget\) requestClose\(\)/);
});

test("UI #265: failed or ambiguous save retains inputs and re-enables the editor; success stays latched for reload", () => {
  assert.match(form, /let acknowledgedSuccess = false;/);
  assert.match(form, /acknowledgedSuccess = true;/);
  assert.match(form, /window\.location\.reload\(\)/);
  assert.match(form, /\} finally \{\s*if \(!acknowledgedSuccess\)/);
  assert.match(form, /setBusy\(false\);\s*onSavePendingChange\?\.\(false\);/);
  assert.match(form, /The settings were not confirmed as saved/);
  assert.doesNotMatch(form, /event\.currentTarget\.reset\(\)/);
});
