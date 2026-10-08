import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("analyzer routing claims current work item and specimen custody in a transaction", () => {
  const api=read("../src/app/api/worklists/[orderItemId]/analyzers/route.ts");
  const tx=api.indexOf("const route = await prisma.$transaction");
  const lock=api.indexOf("FOR UPDATE",tx);
  const ready=api.indexOf("tx.specimenOrderItem.findFirst",lock);
  const mapping=api.indexOf("tx.analyzerTestMapping.count",ready);
  const clinical=api.indexOf("tx.laboratoryResult.count",mapping);
  const insert=api.indexOf("tx.orderItemAnalyzerRoute.create",clinical);
  assert.ok(tx>=0 && lock>tx && ready>lock && mapping>ready && clinical>mapping && insert>clinical);
  const eligibility=api.slice(ready,insert);
  assert.ok(eligibility.includes('status: { in: ["RECEIVED", "IN_PROCESS"] }'));
  assert.ok(eligibility.includes("currentBranchId: analyzer.branchId"));
  assert.ok(eligibility.includes('status: "ACTIVE"'));
  assert.ok(eligibility.includes('approvalStatus: "APPROVED"'));
  assert.ok(eligibility.includes('validationStage: "COMPLETE"'));
  assert.ok(api.includes('error: "analyzer_routing_state_changed"'));
  assert.ok(api.includes('error.code === "P2002"'));
});

test("analyzer outbound interoperability is not implied by route assignment alone", () => {
  const api=read("../src/app/api/worklists/[orderItemId]/analyzers/route.ts");
  assert.ok(api.includes("orderItemAnalyzerRouteEvent.create"));
  assert.ok(api.includes('"ASSIGNED"'));
  assert.ok(!api.includes("ANALYZER_ORDER_SENT"));
});
