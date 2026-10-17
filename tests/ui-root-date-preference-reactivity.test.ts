import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSystemDateDraft, resolveSystemDateDraft } from "../src/lib/system-date-draft.ts";
import {
  DEFAULT_ROOT_DATE_PREFERENCES, ROOT_DATE_ATTRIBUTES,
  readRootDatePreferences, serializedRootDatePreferences,
  subscribeRootDatePreferences,
} from "../src/lib/root-date-preferences.ts";

test("System date drafts never switch the intended date on DD/MM -> MM/DD changes", () => {
  const draft = createSystemDateDraft("05/11/2026", "DD/MM/YYYY");
  assert.equal(draft.iso, "2026-11-05");
  assert.deepEqual(resolveSystemDateDraft("", draft, "MM/DD/YYYY"), {
    text: "11/05/2026", validIso: "2026-11-05", invalid: false,
  });
  assert.deepEqual(resolveSystemDateDraft("", draft, "YYYY-MM-DD"), {
    text: "2026-11-05", validIso: "2026-11-05", invalid: false,
  });
  assert.equal(resolveSystemDateDraft("", draft, "DD MMM YYYY").text, "05 Nov 2026");
  const enteredUS = createSystemDateDraft("05/11/2026", "MM/DD/YYYY");
  assert.equal(enteredUS.iso, "2026-05-11");
  assert.equal(resolveSystemDateDraft("", enteredUS, "DD/MM/YYYY").text, "11/05/2026");
});

test("Invalid, partial, out-of-range, and reset dates cannot silently become valid", () => {
  const ambiguous = createSystemDateDraft("31/12/2026", "DD/MM/YYYY");
  assert.equal(resolveSystemDateDraft("", ambiguous, "MM/DD/YYYY").validIso, "2026-12-31");
  for (const input of ["31/02/2026", "05/1", "05/11/26", "05/11/2026X"]) {
    const invalid = createSystemDateDraft(input, "DD/MM/YYYY");
    assert.equal(resolveSystemDateDraft("", invalid, "MM/DD/YYYY").invalid, true);
    assert.equal(resolveSystemDateDraft("", invalid, "MM/DD/YYYY").validIso, "");
  }
  const good = createSystemDateDraft("05/11/2026", "DD/MM/YYYY");
  assert.deepEqual(resolveSystemDateDraft("", good, "DD/MM/YYYY", "2026-11-06"), {
    text: "05/11/2026", validIso: "", invalid: true,
  });
  assert.deepEqual(resolveSystemDateDraft("2024-02-29", null, "YYYY-MM-DD"), {
    text: "2024-02-29", validIso: "2024-02-29", invalid: false,
  });
  assert.deepEqual(resolveSystemDateDraft("2024-02-29", null, "MM/DD/YYYY"), {
    text: "02/29/2024", validIso: "2024-02-29", invalid: false,
  });
  assert.deepEqual(resolveSystemDateDraft("2024-02-29", createSystemDateDraft("", "DD/MM/YYYY"), "MM/DD/YYYY"), {
    text: "", validIso: "", invalid: false,
  }, "clearing a value cannot reinstate the original default");
});

test("Root preference observer follows all four data settings and disconnects", () => {
  const beforeDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const beforeObserver = Object.getOwnPropertyDescriptor(globalThis, "MutationObserver");
  const observed: Array<{ root: unknown; options: MutationObserverInit }> = [];
  let dispatch: (() => void) | undefined;
  let disconnected = false;
  class FakeObserver {
    constructor(onChange: () => void) { dispatch = onChange; }
    observe(root: unknown, options: MutationObserverInit) { observed.push({ root, options }); }
    disconnect() { disconnected = true; }
  }
  const element = { dataset: { dateFormat: "DD/MM/YYYY", timezone: "Asia/Dubai",
    timeFormat: "12", showSeconds: "true" } };
  Object.defineProperty(globalThis, "document", { configurable: true,
    value: { documentElement: element } });
  Object.defineProperty(globalThis, "MutationObserver", { configurable: true,
    value: FakeObserver });
  try {
    assert.deepEqual(ROOT_DATE_ATTRIBUTES, [
      "data-date-format", "data-timezone", "data-time-format", "data-show-seconds",
    ]);
    assert.equal(DEFAULT_ROOT_DATE_PREFERENCES, "DD/MM/YYYY|UTC|24|false");
    assert.equal(readRootDatePreferences(), "DD/MM/YYYY|Asia/Dubai|12|true");
    const seen: string[] = [];
    const unsub = subscribeRootDatePreferences(() => seen.push(readRootDatePreferences()));
    assert.deepEqual(observed[0].options.attributeFilter, [...ROOT_DATE_ATTRIBUTES]);
    element.dataset.dateFormat = "MM/DD/YYYY";
    element.dataset.timeFormat = "24";
    dispatch?.();
    assert.deepEqual(seen, ["MM/DD/YYYY|Asia/Dubai|24|true"]);
    unsub();
    assert.equal(disconnected, true);
    assert.equal(serializedRootDatePreferences({
      dateFormat: "YYYY-MM-DD", timezone: "Asia/Dubai", timeFormat: "12", showSeconds: false,
    }), "YYYY-MM-DD|Asia/Dubai|12|false");
  } finally {
    if (beforeDocument) Object.defineProperty(globalThis, "document", beforeDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (beforeObserver) Object.defineProperty(globalThis, "MutationObserver", beforeObserver);
    else Reflect.deleteProperty(globalThis, "MutationObserver");
  }
});

test("Shared date, audit time, and live organization clock use a reactive root store", () => {
  const field = readFileSync("src/components/system-date-field.tsx", "utf8");
  const display = readFileSync("src/components/system-date-text.tsx", "utf8");
  const clock = readFileSync("src/components/system-clock.tsx", "utf8");
  assert.match(field, /subscribeRootDatePreferences/);
  assert.match(field, /resolveSystemDateDraft/);
  assert.match(field, /type="hidden" name=\{name\} value=\{validIso\}/);
  assert.match(field, /setCustomValidity/);
  assert.match(display, /useSyncExternalStore\(subscribeRootDatePreferences/);
  assert.match(clock, /useSyncExternalStore\(/);
  assert.match(clock, /liveTimeZone/);
  assert.doesNotMatch(display + field, /const subscribe(?:ToRootDateFormat)? = \(\) => \(\) => \{\}/);
  assert.doesNotMatch(field, /Date\.parse|\.toISOString\(/);
});
