import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { dispatchNotificationDelivery } from "@/lib/notification-dispatch";

export async function POST(_: Request,{params}:{params:Promise<{id:string}>}){
  const session=await requirePermission("notifications.dispatch");
  const {id}=await params;
  const delivery=await prisma.notificationDelivery.findFirst({
    where:{id,organizationId:session.user.organizationId},
    select:{id:true},
  });
  if(!delivery) return NextResponse.json({error:"delivery_not_found"},{status:404});
  const outcome=await dispatchNotificationDelivery(id);
  return NextResponse.json({status:"ok",outcome});
}
