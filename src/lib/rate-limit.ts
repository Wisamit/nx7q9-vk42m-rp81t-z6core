import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

function keyHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Rate limits are shared by all app instances, not kept in local memory.
 * A read-then-write reset at the time-window boundary can lose concurrent
 * increments: the database must decide whether to reset or increment while
 * holding the unique (scope,key_hash) row lock.
 */
export async function checkRateLimit(input: {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitDecision> {
  const now = Date.now();
  const startMs = Math.floor(now / input.windowMs) * input.windowMs;
  const requestedWindow = new Date(startMs);
  const hash = keyHash(input.key || "unknown");

  const claimed = await prisma.$transaction(async tx => {
    // The upsert holds the unique-index row lock through the SELECT below.
    // An older delayed request must never reset a newer window backwards.
    await tx.$executeRaw`
      INSERT INTO request_rate_limits
        (id,scope,key_hash,window_start,count,updated_at)
      VALUES (${randomUUID()},${input.scope},${hash},${requestedWindow},1,NOW(3))
      ON DUPLICATE KEY UPDATE
        count=IF(window_start<${requestedWindow},1,count+1),
        window_start=GREATEST(window_start,${requestedWindow}),
        updated_at=NOW(3)
    `;
    const rows = await tx.$queryRaw<Array<{count:number;windowStart:Date}>>`
      SELECT count,window_start AS windowStart
      FROM request_rate_limits
      WHERE scope=${input.scope} AND key_hash=${hash}
      FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("RATE_LIMIT_ROW_MISSING");
    return rows[0];
  }, { isolationLevel: "ReadCommitted", maxWait: 10000, timeout: 10000 });

  const effectiveStart = claimed.windowStart.getTime();
  const retryAfterSeconds = Math.max(
    1, Math.ceil((effectiveStart + input.windowMs - Date.now()) / 1000),
  );
  return {
    allowed: claimed.count <= input.limit,
    remaining: Math.max(0, input.limit - claimed.count),
    retryAfterSeconds,
  };
}
