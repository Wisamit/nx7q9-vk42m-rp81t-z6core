import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessBranch, permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUiLocale, tr } from "@/lib/ui-i18n";
import { OrderClinicalHandoverManager } from "@/components/order-clinical-handover-manager";

export const dynamic="force-dynamic";
export default async function ClinicalHandoverPage({
  params,searchParams,
}:{
  params:Promise<{id:string}>;
  searchParams:Promise<{page?:string}>;
}) {
  const session=await requirePermission("orders.view");
  const {id}=await params;
  const locale=getUiLocale(session.user.preferredLocale);
  const order=await prisma.labOrder.findFirst({
    where:{id,organizationId:session.user.organizationId},
    select:{id:true,accessionNumber:true,orderingBranchId:true,
      patient:{select:{patientNumber:true,fullNameEn:true,fullNameAr:true}}},
  });
  if(!order||!canAccessBranch(session,order.orderingBranchId))notFound();
  const where={organizationId:session.user.organizationId,orderId:order.id,
    branchId:order.orderingBranchId};
  const total=await prisma.orderClinicalNote.count({where});
  const raw=Number((await searchParams).page||"1");
  const page=Math.min(Number.isSafeInteger(raw)&&raw>=1?raw:1,Math.max(1,Math.ceil(total/50)));
  const rows=await prisma.orderClinicalNote.findMany({
    where,orderBy:[{createdAt:"desc"},{id:"desc"}],take:50,skip:(page-1)*50,
    include:{author:{select:{displayNameEn:true,displayNameAr:true}},
      acknowledgements:{select:{acknowledgedByUserId:true}}},
  });
  const permissions=permissionSet(session);
  const activeBranch=session.activeBranchId===order.orderingBranchId &&
    session.user.branchScopes.some(scope=>scope.branchId===order.orderingBranchId&&
      scope.branch.status==="ACTIVE"&&scope.branch.organizationId===session.user.organizationId);
  return <main className="catalog-shell" dir={locale==="ar"?"rtl":"ltr"}>
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale,"Staff-only clinical order record",
          "السجل السريري الداخلي للطلب")}</p>
        <h1>{tr(locale,"Clinical handover","التسليم السريري")} · {order.accessionNumber}</h1>
        <p className="muted">{order.patient.patientNumber+" — "+
          (locale==="ar"?order.patient.fullNameAr||order.patient.fullNameEn:order.patient.fullNameEn)}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href={`/orders/${id}`}>
          {tr(locale,"Back to order","العودة للطلب")}</Link>
      </div>
    </header>
    <p className="muted">{tr(locale,
      "Annotations are internal staff communications and are not published to portals or inserted into issued reports. Older revisions remain available for audit.",
      "هذه الملاحظات للموظفين فقط ولا تُنشر في البوابات أو التقارير الصادرة، وتبقى النسخ القديمة متاحة للتدقيق.")}</p>
    <OrderClinicalHandoverManager
      locale={locale} orderId={order.id} currentUserId={session.user.id}
      canWrite={permissions.has("orders.create")}
      canCorrectOthers={permissions.has("results.medical_validate")}
      activeBranch={activeBranch}
      notes={rows.map(note=>({
        id:note.id,threadId:note.threadId,revisionNumber:note.revisionNumber,
        category:note.category,language:note.language,body:note.body,status:note.status,
        requiresAcknowledgement:note.requiresAcknowledgement,
        createdByUserId:note.createdByUserId,
        authorName:locale==="ar"?note.author.displayNameAr||note.author.displayNameEn:note.author.displayNameEn,
        createdAt:note.createdAt.toISOString(),correctionReason:note.correctionReason,
        retirementReason:note.retirementReason,replacesNoteId:note.replacesNoteId,
        acknowledgementCount:note.acknowledgements.length,
        acknowledgedByMe:note.acknowledgements.some(ack=>ack.acknowledgedByUserId===session.user.id),
      }))}/>
    <div className="inline-actions">
      {page>1&&<Link className="secondary-link" href={`/orders/${id}/clinical-handover?page=${page-1}`}>
        {tr(locale,"Previous","السابق")}</Link>}
      <span>{tr(locale,"Page","صفحة")} {page} / {Math.max(1,Math.ceil(total/50))} · {total}</span>
      {page<Math.ceil(total/50)&&<Link className="secondary-link"
        href={`/orders/${id}/clinical-handover?page=${page+1}`}>
        {tr(locale,"Next","التالي")}</Link>}
    </div>
  </main>;
}
