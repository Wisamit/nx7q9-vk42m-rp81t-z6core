import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const managers = {
  specimen: readFileSync("src/components/specimen-rejection-reason-manager.tsx", "utf8"),
  identifier: readFileSync("src/components/patient-identifier-scheme-manager.tsx", "utf8"),
  tax: readFileSync("src/components/tax-rule-manager.tsx", "utf8"),
};
const css = readFileSync("src/app/globals.css", "utf8");

test("UI gate #265: three sensitive configuration editors use explicit compact modal triggers", () => {
  for (const [name, source] of Object.entries(managers)) {
    assert.match(source, /import \{ CrudModal \} from "@\/components\/crud-modal"/, name);
    assert.match(source, /<CrudModal/, name);
    assert.match(source, /size="compact"/, name);
    assert.match(source, /type="button"/, name);
    assert.match(source, /onSubmit=\{/, name);
    assert.match(source, /disabled=\{/, name);
    assert.match(source, /role="alert"/, name);
    assert.match(source, /router\.refresh\(\)/, name);
  }
  assert.ok(css.includes(".crud-modal-compact .catalog-form,"));
  assert.ok(css.includes(".crud-modal-compact .form-grid,"));
  assert.ok(css.includes(".crud-modal-compact .admin-grid{grid-template-columns:minmax(0,1fr)}"));
});

test("UI gate #265: specimen create/edit use unique modal forms and preserve API audit endpoints", () => {
  const source = managers.specimen;
  assert.match(source, /openEditor\("create"\)/);
  assert.match(source, /openEditor\(reason\.id\)/);
  assert.match(source, /modal === "create" \? <form/);
  assert.match(source, /editing \? <form key=\{editing\.id\}/);
  assert.match(source, /method: path === "create" \? "POST" : "PATCH"/);
  assert.match(source, /\/api\/settings\/specimen-rejection-reasons/);
  assert.match(source, /setModal\(null\)/);
  assert.doesNotMatch(source, /event\.currentTarget\.reset\(\)/,
    "a failed submit must retain user-entered values");
});

test("UI gate #265: identifier creation and reasoned deactivation remain auditable and separate", () => {
  const source = managers.identifier;
  assert.match(source, /open=\{createOpen\}/);
  assert.match(source, /open=\{deactivation !== null\}/);
  assert.match(source, /name="reason" required maxLength=\{1000\}/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /method: "PATCH"/);
  assert.match(source, /reason \}\)/);
  assert.doesNotMatch(source, /\bprompt\(/,
    "high-impact deactivation must not rely on unstyled browser prompts");
  assert.match(source, /scheme\.identifierType === "OTHER"/);
  assert.match(source, /scheme\.status === "ACTIVE"/);
});

test("UI gate #265: tax publishing retains exact existing user-entered fields and history", () => {
  const source = managers.tax;
  const route = readFileSync("src/app/api/billing/tax-rules/route.ts", "utf8");
  assert.match(source, /onClick=\{\(\) => \{ setMessage\(""\); setOpen\(true\); \}\}/);
  assert.match(source, /open && <form className="catalog-form" onSubmit=\{publish\}/);
  assert.match(source, /\/api\/billing\/tax-rules/);
  assert.match(source, /ratePercent: rate/);
  assert.match(source, /effectiveFrom: form\.get\("effectiveFrom"\)/);
  assert.match(source, /reason: form\.get\("reason"\)/);
  assert.match(source, /setOpen\(false\)/);
  assert.match(source, /Rule Revision History/);
  assert.match(route, /permissionSet\(session\)\.has\("billing\.tax\.manage"\)/);
  assert.match(route, /await tx\.taxRule\.create/);
  assert.match(route, /action: "TAX_RULE_PUBLISHED"/);
});
