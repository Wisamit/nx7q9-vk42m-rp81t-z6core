import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "family-lab-lis",
    check: "live",
    timestamp: new Date().toISOString(),
  }, {
    headers: { "cache-control": "no-store" },
  });
}
