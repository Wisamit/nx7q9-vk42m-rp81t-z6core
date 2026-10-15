import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Stage 137: manual replay claims only exact failed message revision, never resets a newer state", () => {
  const route = readFileSync("src/app/api/analyzers/messages/[id]/replay/route.ts", "utf8");
  const claim = route.indexOf("tx.analyzerMessage.updateMany({");
  const audit = route.indexOf("tx.auditEvent.create({");
  assert.ok(claim > 0 && audit > claim, "CAS update must precede audit");
  const gate = route.slice(claim, audit);
  assert.match(gate, /status: \{ in: \["ERROR", "DEAD_LETTER"\] \}/);
  assert.match(gate, /updatedAt: message\.updatedAt/);
  assert.match(gate, /attempts: message\.attempts/);
  assert.match(gate, /organizationId: session\.user\.organizationId/);
  assert.match(gate, /branchId: message\.branchId/);
  assert.match(gate, /claimed\.count !== 1/);
  assert.match(route, /error: "analyzer_message_replay_state_changed"/);
  assert.match(route, /status: 409/);
  assert.match(route, /requirePermission\("analyzers\.replay"\)/);
  assert.match(route, /canAccessBranch\(session, message\.branchId\)/);
  assert.doesNotMatch(route, /tx\.analyzerMessage\.update\(/);
});

test("Stage 137: report-level interpretation is already present via Stage 92, so Draft PR209 is noncanonical", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20261012180000_report_interpretation_governance/migration.sql", "utf8");
  const api = readFileSync("src/app/api/reports/interpretations/route.ts", "utf8");
  const snapshot = readFileSync("src/lib/report-snapshot.ts", "utf8");
  assert.match(schema, /model ReportInterpretiveComment \{/);
  assert.match(migration, /CREATE TABLE \`report_interpretive_comments\`/);
  assert.match(api, /InterpretationError/);
  assert.match(snapshot, /reportInterpretation/);
});

test("Stage 137: Analyzer Bridge already exists in main; old Draft PR128 should not be merged", () => {
  const worker = readFileSync("bridge/file-worker.mjs", "utf8");
  const protocols = readFileSync("bridge/protocols.mjs", "utf8");
  const mllp = readFileSync("bridge/mllp-listener.mjs", "utf8");
  assert.match(worker, /processReadyFile/);
  assert.match(protocols, /parseHl7Oru/);
  assert.match(mllp, /MLLP_REMOTE_REQUIRES_IP_ALLOWLIST/);
});
