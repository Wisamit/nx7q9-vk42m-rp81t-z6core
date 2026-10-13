import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Stage 80: migrations and Prisma retain nullable lease/token on historical delivery records",()=>{
  const schema=readFileSync("prisma/schema.prisma","utf8");
  const migration=readFileSync("prisma/migrations/20261011180000_notification_dispatch_lease_fencing/migration.sql","utf8");
  assert.match(schema,/dispatchToken\s+String\?\s+@map\("dispatch_token"\)/);
  assert.match(schema,/dispatchLeaseUntil\s+DateTime\?\s+@map\("dispatch_lease_until"\)/);
  assert.match(migration,/ADD COLUMN `dispatch_token` CHAR\(36\) NULL/);
  assert.match(migration,/ADD COLUMN `dispatch_lease_until` DATETIME\(3\) NULL/);
  assert.doesNotMatch(migration,/UPDATE `notification_deliveries`/);
});

test("Stage 80: only one currently unleased, due, tenant-owned notification can be claimed",()=>{
  const source=readFileSync("src/lib/notifications.ts","utf8");
  const start=source.indexOf("export async function dispatchPendingNotifications");
  const claim=source.indexOf("const claim = await db.notificationDelivery.updateMany",start);
  const report=source.indexOf("const version = await db.diagnosticReportVersion.findFirst",claim);
  const send=source.indexOf("await fetch(safeOutboundUrl(config.url)",report);
  assert.ok(start>=0 && claim>start && report>claim && send>report);
  const before=source.slice(start,report);
  assert.match(before,/notification: \{ organizationId \}/);
  assert.match(before,/dispatchLeaseUntil: \{ lte: now \}/);
  assert.match(before,/dispatchLeaseUntil: \{ lte: claimedAt \}/);
  assert.match(before,/attemptCount: delivery\.attemptCount/);
  assert.match(before,/maxAttempts: delivery\.maxAttempts/);
  assert.match(before,/status: delivery\.status/);
  assert.match(before,/dispatchToken: token/);
  assert.match(before,/dispatchLeaseUntil: new Date\(claimedAt\.getTime\(\) \+ DISPATCH_LEASE_MS\)/);
  assert.match(before,/if \(claim\.count !== 1\) continue/);
  assert.match(before,/attemptCount >= delivery\.maxAttempts/);
  assert.match(before,/notification_retry_budget_exhausted/);
});

test("Stage 80: outdated workers cannot overwrite successful delivery nor audit the wrong report",()=>{
  const source=readFileSync("src/lib/notifications.ts","utf8");
  const start=source.indexOf("async function finalizeNotificationClaim");
  const end=source.indexOf("export async function dispatchPendingNotifications",start);
  const body=source.slice(start,end);
  assert.ok(start>=0 && end>start);
  assert.match(body,/db\.\$transaction\(async tx =>/);
  assert.match(body,/where: \{\s*id: delivery\.id,\s*notification: \{ organizationId \},/);
  assert.match(body,/dispatchToken: token,/);
  assert.match(body,/attemptCount: attempt,/);
  assert.match(body,/if \(updated\.count !== 1\) return false/);
  assert.match(body,/dispatchToken: null/);
  assert.match(body,/dispatchLeaseUntil: null/);
  assert.ok(body.indexOf("if (updated.count !== 1) return false") <
    body.indexOf("await tx.reportDeliveryEvent.update"));
  assert.match(source,/if \(settled\) results\.push/);
  assert.match(source,/report_version_superseded_or_retracted/);
  assert.match(source,/version\.version !== version\.report\.currentVersion/);
});

test("Stage 80: provider receives stable same-delivery idempotency evidence across retries",()=>{
  const source=readFileSync("src/lib/notifications.ts","utf8");
  assert.match(source,/const idempotencyKey = "familylab-notification:" \+ delivery\.id/);
  assert.match(source,/"Idempotency-Key": idempotencyKey/);
  assert.match(source,/deliveryId: delivery\.id/);
  assert.match(source,/idempotencyKey,/);
  assert.doesNotMatch(source,/Idempotency-Key": token/);
});
