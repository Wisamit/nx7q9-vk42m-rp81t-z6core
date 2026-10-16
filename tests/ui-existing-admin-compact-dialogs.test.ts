import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Issue #265: existing administrative, billing and analyzer CRUD dialogs share one-third-width presentation", () => {
  const components: Record<string, number> = {
    "analyzer-manager": 3,
    "billing-adjustment-modals": 2,
    "cashier-shift-manager": 3,
    "client-account-manager": 2,
    "client-referrer-forms": 3,
    "patient-create-modal": 1,
    "payment-create-modal": 1,
    "pricing-manager": 4,
    "user-management": 3,
  };
  let total = 0;
  for (const [name, expected] of Object.entries(components)) {
    const file = readFileSync("src/components/" + name + ".tsx", "utf8");
    const modals = (file.match(/<CrudModal\b/g) || []).length;
    assert.equal(modals, expected, name + " CRUD dialogs must still be available");
    assert.equal((file.match(/size="compact"/g) || []).length, expected,
      name + " must have centered compact dialogs for every CRUD editor");
    total += expected;
  }
  assert.equal(total, 22);
});

test("Issue #265: compact dialog width remains responsive without clipping long records or access tables", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.ok(css.includes(".crud-modal-compact{width:min(33.333vw,520px);min-width:0}"));
  assert.ok(css.includes("@media(min-width:761px) and (max-width:1199px)"));
  assert.ok(css.includes("width:min(460px,calc(100vw - 48px))"));
  assert.ok(css.includes(".crud-modal-compact .table-wrap{max-width:100%;overflow-x:auto}"));
  assert.ok(css.includes(".crud-modal-compact .permission-grid{grid-template-columns:minmax(0,1fr)}"));
  assert.ok(css.includes(".crud-modal-compact .form-grid,"));
});
