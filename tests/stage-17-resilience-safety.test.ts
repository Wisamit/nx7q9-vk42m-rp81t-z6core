import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("edge buffering cannot race a disabled continuity policy, and serializes per-node duplicates", () => {
  const continuity=read("../src/app/api/resilience/continuity/route.ts");
  const registration=read("../src/app/api/resilience/edge-nodes/route.ts");
  const sync=read("../src/app/api/resilience/edge/sync/route.ts");
  for (const file of [continuity,registration,sync]) {
    assert.ok(file.includes("SELECT id FROM branches"));
    assert.ok(file.includes("FOR UPDATE"));
    assert.ok(file.includes('isolationLevel:"Serializable"') || file.includes('isolationLevel: "Serializable"'));
    assert.ok(file.includes("organization_id="));
  }
  assert.ok(sync.indexOf("SELECT id FROM branches")<sync.indexOf("SELECT id FROM edge_nodes"));
  assert.ok(sync.indexOf("SELECT id FROM edge_nodes")<sync.indexOf("for (const item of normalized) {",sync.indexOf("await prisma.$transaction")));
  assert.ok(sync.includes("currentPolicy?.mode"));
  assert.ok(sync.includes('existing.eventType !== item.eventType'));
  assert.ok(sync.includes('error: "invalid_edge_payload"'));
  assert.ok(sync.includes('"EDGE_NODE_INACTIVE"'));
  assert.ok(registration.indexOf("SELECT id FROM branches") < registration.indexOf("tx.edgeNode.create"));
});

test("retention execution rechecks live policy after acquiring organization mutex", () => {
  const update=read("../src/app/api/resilience/retention/route.ts");
  const execute=read("../src/app/api/resilience/retention/execute/route.ts");
  for (const s of [update,execute]) {
    assert.ok(s.includes("SELECT id FROM organizations"));
    assert.ok(s.includes("FOR UPDATE"));
    assert.ok(s.includes('isolationLevel:"Serializable"'));
    assert.ok(s.includes("tx.auditEvent.create"));
  }
  assert.ok(execute.indexOf("SELECT id FROM organizations") < execute.indexOf("tx.retentionPolicy.findFirst"));
  assert.ok(execute.indexOf("tx.retentionPolicy.findFirst") < execute.indexOf("tx.userSession.deleteMany"));
  assert.ok(execute.includes('"RETENTION_POLICY_CHANGED"'));
  assert.ok(execute.includes('policy.action!=="PURGE"'));
  assert.ok(execute.includes("inAppPurgeClasses.has(policy.dataClass)"));
  assert.ok(execute.includes("retentionCutoff(policy.retainDays)"));
  assert.ok(execute.includes("session.user.organizationId"));
});

test("backup and DR evidence cannot be verified solely by a caller flag", () => {
  const backups=read("../src/app/api/resilience/backups/route.ts");
  const drills=read("../src/app/api/resilience/drills/route.ts");
  assert.ok(backups.includes('status === "VERIFIED"'));
  assert.ok(backups.includes("!evidenceReference || restoreDurationMinutes === null"));
  assert.ok(backups.includes("restoreTestedAt < backupCreatedAt"));
  assert.ok(drills.includes("!evidenceReference"));
  assert.ok(drills.includes('status==="PASSED"'));
  assert.ok(drills.includes("actualRpoMinutes!>targetRpoMinutes"));
  assert.ok(drills.includes("actualRtoMinutes!>targetRtoMinutes"));
  const ui=read("../src/components/resilience-manager.tsx");
  assert.ok(ui.includes("VERIFIED requires an isolated restore"));
  assert.ok(ui.includes("PASSED/FAILED require completion time"));
});
