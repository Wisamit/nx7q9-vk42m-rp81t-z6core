import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("UI #265: QC violation resolution is a reviewed bilingual action, not a browser prompt", () => {
  const ui = readFileSync("src/components/qc-manager.tsx", "utf8");
  assert.ok(ui.includes('open={resolutionId!==null}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes("saveResolution"));
  assert.ok(ui.includes('if (!resolutionId || !canResolve || submitting.current) return;'));
  assert.ok(ui.includes('name="actionType" required defaultValue="INVESTIGATE"'));
  assert.ok(ui.includes('name="description" required'));
  assert.ok(ui.includes('name="resolutionNote" required'));
  assert.ok(ui.includes('onClose={()=>{if(!submitting.current&&!busy)setResolutionId(null);}}'));
  assert.ok(ui.includes('if (ok) setResolutionId(null)'));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);
  assert.ok(ui.includes("catch {"));
  assert.ok(ui.includes("finally {"));
});

test("UI #265: existing server QC resolution policy requires authorized branch and audited action", () => {
  const api = readFileSync("src/app/api/qc/violations/[id]/resolve/route.ts", "utf8");
  for (const guard of [
    'requirePermission("qc.resolve")',
    "canAccessBranch(session, violation.run.branchId)",
    'violation.status !== "OPEN"',
    '"REPEAT_QC","RECALIBRATE","MAINTENANCE","REPLACE_REAGENT","REPLACE_CONTROL","INVESTIGATE","OTHER"',
    "action_and_resolution_required",
    'status: "RESOLVED"',
    "tx.auditEvent.create",
  ]) assert.ok(api.includes(guard), "Missing server QC gate: " + guard);
});
