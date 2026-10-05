import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

function keyHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function checkRateLimit(input: {
  scope: string;
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitDecision> {
  const now = Date.now();
  const startMs = Math.floor(now / input.windowMs) * input.windowMs;
  const windowStart = new Date(startMs);
  const hash = keyHash(input.key || "unknown");

  async function apply() {
    const existing = await prisma.requestRateLimit.findUnique({
      where: { scope_keyHash: { scope: input.scope, keyHash: hash } },
    });

    if (!existing) {
      try {
        const row = await prisma.requestRateLimit.create({
          data: { scope: input.scope, keyHash: hash, windowStart, count: 1 },
        });
        return row.count;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return apply();
        throw error;
      }
    }

    const sameWindow = existing.windowStart.getTime() === windowStart.getTime();
    const row = await prisma.requestRateLimit.update({
      where: { id: existing.id },
      data: sameWindow ? { count: { increment: 1 } } : { windowStart, count: 1 },
    });
    return row.count;
  }

  const count = await apply();
  const retryAfterSeconds = Math.max(1, Math.ceil((startMs + input.windowMs - now) / 1000));
  return {
    allowed: count <= input.limit,
    remaining: Math.max(0, input.limit - count),
    retryAfterSeconds,
  };
}
