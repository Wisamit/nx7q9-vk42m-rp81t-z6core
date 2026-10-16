import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync("src/components/legacy-row-lineage-review.tsx", "utf8");

test("UI #265: source-row provenance review and governed package tariff drafts use separate compact dialogs", () => {
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.equal((ui.match(/<CrudModal\b/g) || []).length, 2);
  assert.ok(ui.includes('open={selected !== null && uiEditor === "mapping"}'));
  assert.ok(ui.includes('open={selected !== null && uiEditor === "tariff"}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('if (!busy) setUiEditor("")'));
  assert.ok(ui.includes('setUiEditor("mapping")'));
  assert.ok(ui.includes('setUiEditor("tariff")'));
  assert.ok(ui.includes('uiEditor === "mapping" && <form'));
  assert.ok(ui.includes('uiEditor === "tariff" && selected.sourceTable === "price"'));
  assert.ok(ui.includes('selected.classification === "UNRESOLVED"'));
});

test("UI #265: row-hash upload cannot certify parity or activate price/clinical history", () => {
  for (const sourceGate of [
    'const MAX_UPLOAD = 256 * 1024',
    'sourceIndependentlyVerified: false',
    'rowParityCertified: false',
    'clinicalApproved: false',
    'financialApproved: false',
    'activated: false',
    '/api/catalog/legacy-row-lineage/package-tariff-draft',
    'out.status !== "INACTIVE_DRAFT"',
    'expectedRevision: selected.revision',
    'unitPrice: tariffAmount',
    'reason,',
  ]) assert.ok(ui.includes(sourceGate), "Source provenance gate missing: " + sourceGate);
  assert.ok(ui.includes('load(key, cursor)'));
  assert.ok(ui.includes('setUiEditor("")'));
  assert.ok(ui.includes('minLength={12}'));
  assert.ok(ui.includes('input type="date"'));
});
