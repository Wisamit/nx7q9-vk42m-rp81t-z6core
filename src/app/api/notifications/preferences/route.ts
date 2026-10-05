import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

const CHANNELS=["IN_APP","EMAIL","SMS","WHATSAPP"] as const;
function text(value:unknown,max=120){return typeof value==="string"?value.trim().slice(0,max):"";}

export async function POST(request:Request){
  const session=await requirePermission("notifications.view");
  const body=await request.json().catch(()=>null);
  const eventType=text(body?.eventType,120).toUpperCase();
  const channel=CHANNELS.includes(body?.channel)?body.channel as typeof CHANNELS[number]:null;
  if(!eventType||!channel||typeof body?.enabled!=="boolean") return NextResponse.json({error:"invalid_request"},{status:400});

  const preference=await prisma.notificationPreference.upsert({
    where:{organizationId_recipientType_recipientId_eventType_channel:{
      organizationId:session.user.organizationId,recipientType:"USER",recipientId:session.user.id,eventType,channel,
    }},
    update:{enabled:body.enabled},
    create:{organizationId:session.user.organizationId,recipientType:"USER",recipientId:session.user.id,eventType,channel,enabled:body.enabled},
  });
  return NextResponse.json({status:"ok",preference});
}
