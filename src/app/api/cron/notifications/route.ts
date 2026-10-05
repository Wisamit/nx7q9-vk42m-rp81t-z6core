import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dispatchNotificationDelivery } from "@/lib/notification-dispatch";

export async function POST(request: Request) {
  const configured = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!configured || auth !== "Bearer " + configured) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
      channel: { in: ["EMAIL","SMS","WHATSAPP"] },
      status: { in: ["QUEUED","FAILED"] },
      attemptCount: { lt: 5 },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  const outcomes: Record<string, number> = {};
  for (const item of deliveries) {
    const result = await dispatchNotificationDelivery(item.id);
    outcomes[result.status] = (outcomes[result.status] || 0) + 1;
  }
  return NextResponse.json({ status: "ok", processed: deliveries.length, outcomes });
}
