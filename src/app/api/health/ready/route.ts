import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const startedAt = Date.now();
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return NextResponse.json({
      status: "ready",
      database: "reachable",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({
      status: "not_ready",
      database: "unreachable",
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
