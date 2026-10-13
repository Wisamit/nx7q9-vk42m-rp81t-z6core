import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  authorizeCronRequest, cronPlan, CronConfigurationError, dueWebhookFilter,
  type CronEnvironment,
} from "../src/lib/scheduled-dispatch.ts";

const A = "11111111-2222-4333-8444-555555555555";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SECRET = "this-is-a-unique-high-entropy-scheduler-secret-0123456789";
const config = (): CronEnvironment => ({
  FAMILY_LAB_CRON_ENABLED: "true",
  FAMILY_LAB_CRON_SECRET: SECRET,
  FAMILY_LAB_CRON_ORGANIZATION_IDS: A + "," + B,
  FAMILY_LAB_CRON_TAT_ENABLED: "true",
  FAMILY_LAB_CRON_NOTIFICATIONS_ENABLED: "false",
  FAMILY_LAB_CRON_WEBHOOKS_ENABLED: "true",
});
test("Stage 106: cron authorization is fail-closed and constant-time", () => {
  const env = config();
  assert.deepEqual(cronPlan(env), {
    organizationIds: [A, B],
    tat: true, notifications: false, webhooks: true,
  });
  assert.equal(authorizeCronRequest("Bearer "+SECRET, A, env).ok, true);
  assert.equal(authorizeCronRequest("Bearer "+SECRET, B, env).ok, true);
  for (const invalid of [
    null, "Basic "+SECRET, "Bearer "+SECRET+" ", "Bearer bad-token",
    "Bearer "+SECRET+"\n", "bearer "+SECRET,
  ]) assert.equal(authorizeCronRequest(invalid, A, env).ok, false);
  assert.equal(authorizeCronRequest("Bearer "+SECRET, "ffffffff-ffff-4fff-8fff-ffffffffffff", env).ok, false);
  assert.equal(authorizeCronRequest("Bearer "+SECRET, "1' OR 1=1", env).ok, false);
  assert.equal(authorizeCronRequest("Bearer "+SECRET, null, env).ok, false);
});
test("Stage 106: missing, duplicate, invalid or unspecified host configuration never permits sending", () => {
  for (const patch of [
    { FAMILY_LAB_CRON_ENABLED: undefined },
    { FAMILY_LAB_CRON_ENABLED: "false" },
    { FAMILY_LAB_CRON_SECRET: "short" },
    { FAMILY_LAB_CRON_SECRET: undefined },
    { FAMILY_LAB_CRON_ORGANIZATION_IDS: undefined },
    { FAMILY_LAB_CRON_ORGANIZATION_IDS: "anything" },
    { FAMILY_LAB_CRON_ORGANIZATION_IDS: A + "," + A },
    { FAMILY_LAB_CRON_ORGANIZATION_IDS: A + ",not-uuid" },
    { FAMILY_LAB_CRON_TAT_ENABLED: "false", FAMILY_LAB_CRON_WEBHOOKS_ENABLED:"false" },
    { FAMILY_LAB_CRON_NOTIFICATIONS_ENABLED: "yes" },
  ]) {
    const env = {...config(),...patch};
    assert.throws(() => cronPlan(env), CronConfigurationError);
    assert.equal(authorizeCronRequest("Bearer "+SECRET, A, env).ok, false);
  }
});
test("Stage 106: due webhook selector restricts organization, active endpoint and branch", () => {
  const now = new Date("2026-10-13T10:00:00.000Z");
  const filter = dueWebhookFilter(A, now);
  assert.equal(filter.organizationId, A);
  assert.equal(filter.subscription.organizationId, A);
  assert.equal(filter.subscription.endpoint.organizationId, A);
  assert.equal(filter.subscription.status, "ACTIVE");
  assert.equal(filter.subscription.endpoint.status, "ACTIVE");
  assert.equal(filter.subscription.endpoint.OR[0].branchId, null);
  assert.equal(filter.subscription.endpoint.OR[1].branch?.status, "ACTIVE");
  assert.deepEqual(filter.OR.map(s => s.status), ["QUEUED","FAILED","SENT"]);
  assert.equal(filter.OR[2].updatedAt?.lte.toISOString(),"2026-10-13T09:55:00.000Z");
});
test("Stage 106: endpoint has no cookie fallback, reads tenant only after auth, and never returns PII", () => {
  const route = readFileSync("src/app/api/cron/dispatch/route.ts", "utf8");
  const worker = readFileSync("scripts/operations/run-scheduled-dispatch.mjs", "utf8");
  const outbound = readFileSync("src/lib/notifications.ts", "utf8");
  assert.match(route, /authorizeCronRequest\(request\.headers\.get\("authorization"\)/);
  assert.match(route, /organization\.findFirst/);
  assert.match(route, /where: dueWebhookFilter\(organization\.id, now\)/);
  assert.match(route, /processTatEscalations\(prisma, organization\.id/);
  assert.match(route, /dispatchPendingNotifications\(prisma, organization\.id/);
  assert.match(route, /SCHEDULED_COMMUNICATION_DISPATCH_RUN/);
  assert.match(route, /actorUserId: null/);
  assert.match(route, /operation === "NOTIFICATIONS"/);
  assert.match(route, /operation === "WEBHOOKS"/);
  assert.doesNotMatch(route, /getCurrentSession|requirePermission|cookies\(/);
  assert.doesNotMatch(route, /\.delete\(|\.createMany\(/);
  assert.match(worker, /FAMILY_LAB_CRON_SECRET/);
  assert.match(worker, /Bearer /);
  assert.match(worker, /parsed\.protocol !== "https:"/);
  assert.doesNotMatch(worker, /console\.log\(secret|console\.error\(secret/);
  assert.match(outbound, /safeOutboundUrl\(config\.url\)/);
  assert.match(outbound, /AbortSignal\.timeout\(12_000\)/);
  assert.match(outbound, /redirect: "error"/);
  assert.match(outbound, /Idempotency-Key/);
});
