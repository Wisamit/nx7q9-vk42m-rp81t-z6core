import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { retainedDisposalBlock, retentionDueAt, independentAuthorization } from "../src/lib/specimen-retention-safety.ts";

const base = {
  status: "IN_PROCESS", collectedAt: new Date("2026-10-01T12:00:00.000Z"),
  orderStatus: "COMPLETED", orderItemStatuses: ["VERIFIED"],
  latestReportStatus: "FINAL", activeTransferCount: 0, activeSendOutCount: 0,
  unresolvedChildCount: 0, unreleasedResultCount: 0, activeClinicalHoldCount: 0,
};

test("Stage 101: no clinical release/retention evidence must fail closed", () => {
  assert.equal(retainedDisposalBlock(base), null);
  for (const [name, update, expected] of [
    ["wrong specimen status", {status:"QUARANTINED"}, "specimen_not_retained"],
    ["no collection time", {collectedAt:null}, "collection_date_not_recorded"],
    ["order pending", {orderStatus:"IN_PROGRESS"}, "order_not_completed"],
    ["not all work completed", {orderItemStatuses:["VERIFIED","IN_PROGRESS"]}, "pending_order_tests"],
    ["no final report", {latestReportStatus:"PARTIAL"}, "released_final_report_required"],
    ["retracted report", {latestReportStatus:"RETRACTED"}, "released_final_report_required"],
    ["open shipment", {activeTransferCount:1}, "active_transfer"],
    ["outside laboratory work", {activeSendOutCount:1}, "active_sendout"],
    ["child aliquot", {unresolvedChildCount:1}, "child_specimens_present"],
    ["unreleased draft result", {unreleasedResultCount:1}, "unreleased_results"],
    ["quality hold", {activeClinicalHoldCount:1}, "active_quality_hold"],
  ] as Array<[string, Partial<Parameters<typeof retainedDisposalBlock>[0]>, string]>) {
    assert.equal(retainedDisposalBlock({...base,...update}), expected, name);
  }
  assert.equal(retentionDueAt(base.collectedAt,7).toISOString(),"2026-10-08T12:00:00.000Z");
  assert.throws(()=>retentionDueAt(base.collectedAt,0));
  assert.throws(()=>retentionDueAt(base.collectedAt,1.5));
  assert.throws(()=>retentionDueAt(new Date("bad date"),7));
});

test("Stage 101: requester and quality authorizer must differ; executor cannot be authorizer", () => {
  assert.equal(independentAuthorization("requester","quality"),true);
  assert.equal(independentAuthorization("requester","requester"),false);
  assert.equal(independentAuthorization("requester","quality","quality"),false);
  assert.equal(independentAuthorization("requester","quality","requester"),true);
});

test("Stage 101: immutable approval provenance, active branch, no default legal policy and custody gates",()=>{
  const schema=readFileSync("prisma/schema.prisma","utf8");
  const migration=readFileSync("prisma/migrations/20261013001000_specimen_retention_disposal_governance/migration.sql","utf8");
  const api=readFileSync("src/app/api/specimens/disposal-cases/route.ts","utf8");
  const policy=readFileSync("src/app/api/specimens/retention-policies/route.ts","utf8");
  const page=readFileSync("src/app/specimens/retention/page.tsx","utf8");
  const ui=readFileSync("src/components/specimen-retention-manager.tsx","utf8");
  assert.match(schema,/model SpecimenRetentionPolicy \{/);
  assert.match(schema,/model SpecimenDisposalCase \{/);
  assert.match(migration,/REFERENCES `specimens`/);
  assert.match(migration,/REFERENCES `specimen_types`/);
  assert.match(migration,/CHECK \(`minimum_days` BETWEEN 1 AND 73000\)/);
  assert.doesNotMatch(migration,/INSERT INTO `specimen_retention_policies`/);
  for(const source of [api,policy]){
    assert.match(source,/session.activeBranchId/);
    assert.match(source,/tx.userBranchScope.findUnique/);
    assert.match(source,/organizationId: ctx.organizationId/);
    assert.match(source,/isolationLevel: "Serializable"/);
    assert.match(source,/tx.auditEvent.create/);
  }
  assert.match(policy,/quality.nonconformance.manage/);
  assert.match(policy,/policy.createdByUserId === ctx.session.user.id/);
  assert.match(api,/FOR UPDATE/);
  assert.match(api,/policy.approvedAt > specimen.collectedAt/);
  assert.match(api,/retainedDisposalBlock/);
  assert.match(api,/independentAuthorization/);
  assert.match(api,/preanalyticalVersion/);
  assert.match(api,/status: "DISPOSED"/);
  assert.match(api,/tx.specimenEvent.create/);
  assert.doesNotMatch(api,/tx.laboratoryResult.update|tx.diagnosticReportVersion.update|tx.invoice.update/);
  assert.match(page,/SpecimenRetentionManager/);
  assert.match(ui,/locale === "ar" \? "rtl" : "ltr"/);
  assert.match(ui,/Authorize independently/);
});
