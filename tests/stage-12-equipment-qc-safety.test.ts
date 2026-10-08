import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("QC resolution claims OPEN record atomically before creating any action", () => {
  const route = source("../src/app/api/qc/violations/[id]/resolve/route.ts");
  const claim = route.indexOf("tx.qcRuleViolation.updateMany(");
  const condition = route.indexOf('status: "OPEN"', claim);
  const count = route.indexOf("claim.count !== 1", condition);
  const action = route.indexOf("tx.qcAction.create(", count);
  assert.ok(claim >= 0 && condition > claim && count > condition && action > count);
  assert.ok(route.includes('"QC_VIOLATION_ALREADY_RESOLVED"'));
  assert.ok(route.includes('isolationLevel: "Serializable"'));
});

test("QC target overlap check is behind analyzer row lock in creation transaction", () => {
  const route = source("../src/app/api/qc/targets/route.ts");
  const transaction = route.indexOf("prisma.$transaction(async tx =>");
  const lock = route.indexOf("FOR UPDATE", transaction);
  const overlap = route.indexOf("tx.qcTarget.findFirst", lock);
  const create = route.indexOf("tx.qcTarget.create", overlap);
  assert.ok(transaction >= 0 && lock > transaction && overlap > lock && create > overlap);
  assert.ok(route.includes('error: "overlapping_qc_target"'));
});

test("QC run entry serializes analyzer history and rechecks effective-dated QC targets", () => {
  const route = source("../src/app/api/qc/runs/route.ts");
  const transaction = route.indexOf("prisma.$transaction(async tx =>");
  const lock = route.indexOf("FOR UPDATE", transaction);
  const recheck = route.indexOf("tx.qcTarget.findMany(", lock);
  const create = route.indexOf("tx.qcRun.create(", recheck);
  const history = route.indexOf("tx.qcResult.findMany(", create);
  assert.ok(transaction >= 0 && lock > transaction && recheck > lock && create > recheck && history > create);
  assert.ok(route.includes("QC_TARGET_OR_LOT_CHANGED"));
});

test("downtime closing never automatically certifies equipment fit for service", () => {
  const route = source("../src/app/api/equipment/[id]/downtime/route.ts");
  const lock = route.indexOf("FOR UPDATE");
  const fresh = route.indexOf("tx.equipment.findFirst(", lock);
  const close = route.indexOf('if (action === "CLOSE")', fresh);
  const conditional = route.indexOf("tx.equipmentDowntime.updateMany(", close);
  const restore = route.indexOf('if (open) throw new Error("DOWNTIME_STILL_OPEN")', conditional);
  assert.ok(lock >= 0 && fresh > lock && close > fresh && conditional > close && restore > conditional);
  assert.ok(route.includes('"EQUIPMENT_RETURNED_TO_SERVICE"'));
  assert.ok(route.includes("calibration.approvedAt"));
  assert.ok(route.includes("maintenancePlans.length"));
});

test("result QC gate treats overdue maintenance and unsigned calibration as blockers", () => {
  const gate = source("../src/lib/qc-gate.ts");
  for (const reason of ["EQUIPMENT_MAINTENANCE_IN_PROGRESS", "EQUIPMENT_MAINTENANCE_OVERDUE", "CALIBRATION_UNAPPROVED"]) {
    assert.ok(gate.includes('reasons.push({ code: "' + reason + '"'));
    assert.ok(gate.includes('"' + reason + '",'));
  }
});

test("maintenance completion preserves safety hold and requires a separate RESTORE", () => {
  const route = source("../src/app/api/equipment/[id]/maintenance/route.ts");
  assert.ok(route.includes("SELECT id FROM equipment WHERE id ="));
  assert.ok(route.includes("FOR UPDATE"));
  assert.ok(route.includes('status: "UNDER_MAINTENANCE"'));
  assert.ok(route.includes('status: "OUT_OF_SERVICE"'));
  assert.ok(!route.includes('data: { status: "ACTIVE" }'));
});

test("result release rechecks the QC gate behind analyzer and equipment locks", () => {
  const route = source("../src/app/api/results/[id]/release/route.ts");
  const tx = route.indexOf("prisma.$transaction(async (tx) =>");
  const analyzerLock = route.indexOf("SELECT id FROM analyzers", tx);
  const equipmentLock = route.indexOf("SELECT id FROM equipment", analyzerLock);
  const gated = route.indexOf("resolveAnalyzerQcGate(tx", equipmentLock);
  const claim = route.indexOf("tx.laboratoryResult.updateMany(", gated);
  assert.ok(tx >= 0 && analyzerLock > tx && equipmentLock > analyzerLock && gated > equipmentLock && claim > gated);
  assert.ok(route.includes('released === "QC_HOLD"'));
});

test("bridge claim defers outage without cancelling a queued work order", () => {
  const route = source("../src/app/api/integrations/analyzers/[id]/work-orders/claim/route.ts");
  const equipment = route.indexOf("SELECT id, status FROM equipment");
  const downtime = route.indexOf("tx.equipmentDowntime.count(", equipment);
  const noDispatch = route.indexOf("if (openDowntime > 0) return null;", downtime);
  const cancel = route.indexOf('status: eligible ? "DEAD_LETTER" : "CANCELLED"', noDispatch);
  assert.ok(equipment >= 0 && downtime > equipment && noDispatch > downtime && cancel > noDispatch);
});
