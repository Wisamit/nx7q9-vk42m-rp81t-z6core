import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogDriftObservationToken } from "../src/lib/catalog-drift-triage.ts";
import { expertDispositionAllowed } from "../src/lib/catalog-expert-disposition.ts";

const route = readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts", "utf8");
const ui = readFileSync("src/components/catalog-expert-review-queue.tsx", "utf8");
const oldTest = readFileSync("tests/stage-45-legacy-unit-preparation-mariadb.integration.test.ts", "utf8");

test("Stage 56: expert preflight is a separately scoped GET without clinical/price writes", () => {
  assert.match(route, /query\.get\("reviewFlagId"\)/);
  assert.match(route, /expert_preflight_invalid_request/);
  assert.match(route, /inspectBundleDrift\(request, context, null, \{[\s\S]*?\}, true\)/);
  assert.match(route, /expertPreflight = false/);
  assert.match(route, /createdByUserId: session\.user\.id/);
  assert.match(route, /orgLock = await tx\.\$queryRaw/);
  assert.match(route, /batch\.createdByUserId === session\.user\.id/);
  assert.match(route, /expertDispositionAllowed\(/);
  assert.match(route, /latestFlag\?\.id === expertFlag!\.id/);
  assert.match(route, /const priorDecision = await tx\.auditEvent\.findFirst/);
  assert.match(route, /if \(expertPreflight\) return \{/);
  const preflight = route.indexOf('status: "EXPERT_REVIEW_READY"');
  const auditWrite = route.indexOf('action: "CATALOG_BUNDLE_EXPERT_DECISION_RECORDED",');
  assert.ok(preflight > 0 && auditWrite > preflight,
    "return a preview before the approval-like audit writer; preview cannot write");
  assert.match(route, /approved: false, activated: false, liveWrites: false/);
  assert.match(route, /expert_decision_conflict/);
  assert.match(route, /expert_decision_integrity_error/);
  assert.match(route, /sourceType: BUNDLE_REVIEW_SOURCE/);
  assert.match(route, /isolationLevel: "RepeatableRead"/);
  assert.doesNotMatch(route,
    /tx\.(?:labTest|testComponent|unit|referenceInterval|priceList|priceListItem|catalogImportBatch|catalogImportRow)\.(?:create|update|delete|upsert)/);
});

test("Stage 56: old or crossed observation cannot be preflighted as ready", () => {
  const key = "stage56-only-test-observation-secret-strong";
  const checksum = "a".repeat(64);
  const source = { unitPrice: "119.0000", currency: "AED" };
  const original = { unitPrice: "129.0000", currency: "AED" };
  const old = catalogDriftObservationToken(
    key, checksum, 1, "PRICE_LIST_ITEM", source, original,
  );
  const permissions = new Set(["catalog.manage", "pricing.manage"]);
  const base = {
    expertUserId: "reviewer", batchAuthorId: "author", flagActorUserId: "author",
    eventCategory: "FINANCIAL", entityType: "PRICE_LIST_ITEM",
    flaggedEvidence: old, latestEvidence: old,
    sessionPermissions: permissions, livePermissions: permissions,
    isLatestFlag: true, isOpenDraft: true,
  };
  assert.deepEqual(expertDispositionAllowed(base), { allowed: true, category: "FINANCIAL" });
  for (const live of [
    { ...original, unitPrice: "129.0001" },
    { ...original, currency: "USD" },
  ]) {
    assert.deepEqual(expertDispositionAllowed({
      ...base, latestEvidence: catalogDriftObservationToken(
        key, checksum, 1, "PRICE_LIST_ITEM", source, live,
      ),
    }), { allowed: false, reason: "expert_evidence_stale" });
  }
  assert.deepEqual(expertDispositionAllowed({
    ...base, isLatestFlag: false,
  }), { allowed: false, reason: "expert_evidence_stale" });
  assert.deepEqual(expertDispositionAllowed({
    ...base, livePermissions: new Set(["catalog.manage"]),
  }), { allowed: false, reason: "expert_domain_permission_required" });
  assert.deepEqual(expertDispositionAllowed({
    ...base, expertUserId: "author",
  }), { allowed: false, reason: "independent_reviewer_required" });
});

test("Stage 56: bilingual UI cannot enable an expert disposition before explicit preflight", () => {
  assert.match(ui, /\?reviewFlagId=/);
  assert.match(ui, /status === "EXPERT_REVIEW_READY"/);
  assert.match(ui, /"READY"/);
  assert.match(ui, /"STALE"/);
  assert.match(ui, /"CONFLICT"/);
  assert.match(ui, /inspections\[entry\.flagEventId\] !== "READY"/);
  assert.match(ui, /PUT independently validates all scopes/);
  assert.match(ui, /Verify current evidence/);
  assert.match(ui, /فحص الدليل الحالي/);
  assert.match(ui, /Return for correction/);
  assert.match(ui, /Confirm finding \(not approval\)/);
});

test("Stage 56: Stage 45 concurrency still asserts two-writer serialization but no circular FK wait", () => {
  const updated = oldTest.indexOf("const [claim]=await writer.execute<mysql.ResultSetHeader>");
  const startSecond = oldTest.indexOf("await reader.beginTransaction();", updated);
  const commit = oldTest.indexOf("await writer.commit();", updated);
  const secondLock = oldTest.indexOf("const competing=reader.execute<mysql.RowDataPacket[]>", updated);
  assert.ok(updated > 0 && startSecond > updated &&
    secondLock > startSecond && commit > secondLock);
  assert.match(oldTest, /assert\.equal\(claim\.affectedRows,1\)/);
  assert.match(oldTest, /assert\.equal\(replay\.affectedRows,0/);
  assert.match(oldTest, /resolveLegacyPreparedUnit\(after,"stage45-unit"\)/);
});
