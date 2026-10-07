import test from "node:test";
import assert from "node:assert/strict";
import { shouldAdvanceResultEntryOnEnter } from "../src/lib/result-entry-keyboard.ts";

test("result entry Enter advances when safe", () => {
  assert.equal(shouldAdvanceResultEntryOnEnter({ key: "Enter" }), true);
  assert.equal(shouldAdvanceResultEntryOnEnter({ key: "Enter", shiftKey: false, isComposing: false }), true);
});

test("result entry keyboard helper does not hijack modified or composition input", () => {
  assert.equal(shouldAdvanceResultEntryOnEnter({ key: "Tab" }), false);
  assert.equal(shouldAdvanceResultEntryOnEnter({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldAdvanceResultEntryOnEnter({ key: "Enter", isComposing: true }), false);
});
