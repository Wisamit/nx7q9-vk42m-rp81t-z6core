import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_: Request,{params}:{params:Promise<{id:string}>}){
  const session=await requirePermission("notifications.view");
  const {id}=await params;
  const delivery=await prisma.notificationDelivery.findFirst({
    where:{id,organizationId:session.user.organizationId,recipientUserId:session.user.id,channel:"IN_APP"},
  });
  if(!delivery) return NextResponse.json({error:"notification_not_found"},{status:404});
  if(!delivery.readAt){
    await prisma.notificationDelivery.update({where:{id},data:{readAt:new Date()}});
  }
  return NextResponse.json({status:"ok"});
}
