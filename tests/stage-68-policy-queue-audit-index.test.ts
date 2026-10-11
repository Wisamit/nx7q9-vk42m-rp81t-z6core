import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261011143000_policy_review_queue_audit_index/migration.sql","utf8",
);
const route = readFileSync("src/app/api/catalog/imports/policy-review-queue/route.ts","utf8");

test("Stage 68: AuditEvent schema and migration index order match every equality filter and keyset",()=>{
  const columns=[
    "organizationId", "branchId", "action", "entityType", "occurredAt", "id",
  ];
  const sqlColumns=[
    "organization_id", "branch_id", "action", "entity_type", "occurred_at", "id",
  ];
  assert.match(schema,new RegExp(
    "@@index\\(\\["+columns.join(", ")+"\\], map: \"audit_events_policy_queue_scan_idx\"\\)",
  ));
  const part=migration.slice(migration.indexOf("CREATE INDEX"));
  for(let i=0;i<sqlColumns.length;i++){
    assert.ok(part.indexOf("`"+sqlColumns[i]+"`") >= 0);
    if(i) assert.ok(part.indexOf("`"+sqlColumns[i-1]+"`") <
      part.indexOf("`"+sqlColumns[i]+"`"));
  }
  assert.match(part,/CREATE INDEX `audit_events_policy_queue_scan_idx`/);
  assert.doesNotMatch(part,/\b(?:DELETE|UPDATE|TRUNCATE|DROP|REPLACE|ALTER TABLE)\b/i);
});

test("Stage 68: existing queue work remains tenant-locked and end-to-end fail closed",()=>{
  assert.match(route,/SELECT id FROM organizations WHERE id = \$\{organizationId\}/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/isolationLevel: "RepeatableRead"/);
  assert.match(route,/branchId: scope\.branchId/);
  assert.match(route,/action: "CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED"/);
  assert.match(route,/action: "CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED"/);
  assert.match(route,/tx\.auditEvent\.count\(\{ where: draftWhere \}\)/);
  assert.match(route,/tx\.auditEvent\.count\(\{ where: reviewWhere \}\)/);
  assert.match(route,/orderBy: \[\{ occurredAt: "desc" \}, \{ id: "desc" \}\]/);
  assert.match(route,/occurredAt: \{ lt: cursor\.occurredAt \}/);
  assert.match(route,/occurredAt: cursor\.occurredAt, id: \{ lt: cursor\.id \}/);
  assert.match(route,/verifiedPolicyQueueCandidate\(/);
  assert.match(route,/validatePolicyReviewBatchScope\(tx,/);
  assert.match(route,/samePolicyQueueAuditWatermark\(/);
  assert.match(route,/approval: false, signingEnabled: false/);
  assert.doesNotMatch(route,/tx\.(?:labTest|unit|priceList|priceListItem|referenceInterval|catalogImportRow)\.(?:create|update|upsert|delete)/);
});
