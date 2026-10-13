import { createHash, timingSafeEqual } from "node:crypto";

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export type CronEnvironment = {
  FAMILY_LAB_CRON_ENABLED?: string;
  FAMILY_LAB_CRON_SECRET?: string;
  FAMILY_LAB_CRON_ORGANIZATION_IDS?: string;
  FAMILY_LAB_CRON_TAT_ENABLED?: string;
  FAMILY_LAB_CRON_NOTIFICATIONS_ENABLED?: string;
  FAMILY_LAB_CRON_WEBHOOKS_ENABLED?: string;
};
export type CronPlan = {
  organizationIds: string[];
  tat: boolean;
  notifications: boolean;
  webhooks: boolean;
};
export class CronConfigurationError extends Error {
  constructor() { super("scheduled_dispatch_configuration_incomplete"); }
}
export function cronPlan(env: CronEnvironment): CronPlan {
  if (env.FAMILY_LAB_CRON_ENABLED !== "true") throw new CronConfigurationError();
  const secret = env.FAMILY_LAB_CRON_SECRET;
  if (!secret || secret.length < 32 || secret.length > 256 || /\s/.test(secret)) {
    throw new CronConfigurationError();
  }
  const raw = env.FAMILY_LAB_CRON_ORGANIZATION_IDS;
  if (!raw || raw.length > 2400) throw new CronConfigurationError();
  const ids = raw.split(",").map(id => id.trim().toLowerCase());
  if (!ids.length || ids.length > 32 || ids.some(id => !ID.test(id))
      || new Set(ids).size !== ids.length) throw new CronConfigurationError();
  const options = [
    env.FAMILY_LAB_CRON_TAT_ENABLED,
    env.FAMILY_LAB_CRON_NOTIFICATIONS_ENABLED,
    env.FAMILY_LAB_CRON_WEBHOOKS_ENABLED,
  ];
  if (options.some(flag => flag !== undefined && flag !== "true" && flag !== "false")) {
    throw new CronConfigurationError();
  }
  const tat = env.FAMILY_LAB_CRON_TAT_ENABLED === "true";
  const notifications = env.FAMILY_LAB_CRON_NOTIFICATIONS_ENABLED === "true";
  const webhooks = env.FAMILY_LAB_CRON_WEBHOOKS_ENABLED === "true";
  if (!tat && !notifications && !webhooks) throw new CronConfigurationError();
  return { organizationIds: ids, tat, notifications, webhooks };
}

export function authorizeCronRequest(
  bearer: string | null,
  organizationId: unknown,
  env: CronEnvironment,
): { ok: true; organizationId: string; plan: CronPlan } | { ok: false } {
  let plan: CronPlan;
  try { plan = cronPlan(env); } catch { return { ok: false }; }
  if (typeof organizationId !== "string" || !ID.test(organizationId)) return { ok: false };
  const selected = organizationId.toLowerCase();
  if (!plan.organizationIds.includes(selected)) return { ok: false };
  // Reject different auth schemes, whitespace and unbounded tokens before constant-time comparison.
  const match = bearer?.match(/^Bearer ([A-Za-z0-9_~+\/=.:-]{32,256})$/);
  if (!match) return { ok: false };
  const received = createHash("sha256").update(match[1]).digest();
  const expected = createHash("sha256").update(env.FAMILY_LAB_CRON_SECRET!).digest();
  if (!timingSafeEqual(received, expected)) return { ok: false };
  return { ok: true, organizationId: selected, plan };
}

export function dueWebhookFilter(organizationId: string, now: Date) {
  const staleSent = new Date(now.getTime() - 5 * 60_000);
  return {
    organizationId,
    subscription: {
      organizationId,
      status: "ACTIVE" as const,
      endpoint: {
        organizationId,
        status: "ACTIVE" as const,
        OR: [
          { branchId: null },
          { branch: { organizationId, status: "ACTIVE" as const } },
        ],
      },
    },
    OR: [
      { status: "QUEUED" as const },
      { status: "FAILED" as const,
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
      { status: "SENT" as const, updatedAt: { lte: staleSent } },
    ],
  };
}
