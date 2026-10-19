import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSettingsImageSelectionGate } from "../src/lib/settings-image-selection.ts";

test("a pending image is detected synchronously before the Save button rerenders", () => {
  const gate = createSettingsImageSelectionGate();
  assert.equal(gate.hasPending(), false);
  const token = gate.begin("logoDataUrl");
  assert.equal(gate.hasPending(), true);
  assert.equal(gate.complete("logoDataUrl", token), true);
  assert.equal(gate.hasPending(), false);
});

test("a slow older image reader cannot overwrite the newer selection", () => {
  const gate = createSettingsImageSelectionGate();
  const first = gate.begin("logoDataUrl");
  const latest = gate.begin("logoDataUrl");
  assert.equal(gate.complete("logoDataUrl", first), false);
  assert.equal(gate.hasPending(), true, "stale completion cannot unlock Save for the latest reader");
  assert.equal(gate.complete("logoDataUrl", latest), true);
  assert.equal(gate.hasPending(), false);
});

test("concurrent logo and favicon reads independently block Save until both finish", () => {
  const gate = createSettingsImageSelectionGate();
  const logo = gate.begin("logoDataUrl");
  const favicon = gate.begin("faviconDataUrl");
  assert.equal(gate.complete("logoDataUrl", logo), true);
  assert.equal(gate.hasPending(), true);
  assert.equal(gate.complete("faviconDataUrl", favicon), true);
  assert.equal(gate.hasPending(), false);
});

test("removal cancels the pending choice; a late FileReader completion cannot restore it", () => {
  const gate = createSettingsImageSelectionGate();
  const old = gate.begin("faviconDataUrl");
  gate.cancel("faviconDataUrl");
  assert.equal(gate.hasPending(), false);
  assert.equal(gate.complete("faviconDataUrl", old), false);
  const newReader = gate.begin("faviconDataUrl");
  assert.equal(gate.complete("faviconDataUrl", newReader), true);
});

test("settings UI guards the actual save request, asynchronous readers and remove controls", () => {
  const form = readFileSync("src/components/system-settings-form.tsx", "utf8");
  assert.match(form, /if \(imageGate\.current\.hasPending\(\)\)/);
  assert.match(form, /disabled=\{busy \|\| uploadingImages\}/);
  assert.match(form, /if \(gate\.complete\(key, version\)\) set\(key, dataUrl\)/);
  assert.match(form, /imageGate\.current\.cancel\(key\)/);
  assert.match(form, /reader\.onabort =/);
  assert.match(form, /disabled=\{busy\} aria-label=\{tr\("Upload center logo"/);
  assert.match(form, /disabled=\{busy\} aria-label=\{tr\("Upload browser icon"/);
  assert.match(form, /disabled=\{busy\} onClick=\{\(\) => removeImage\("logoDataUrl"\)\}/);
  assert.match(form, /disabled=\{busy\} onClick=\{\(\) => removeImage\("faviconDataUrl"\)\}/);
  assert.match(form, /يجب اكتمال تحميل الشعار/);
  assert.match(form, /Finish loading the selected logo/);
  assert.match(form, /if \(submitting\.current\) return;/);
  assert.match(form, /The settings were not confirmed as saved/);
});
