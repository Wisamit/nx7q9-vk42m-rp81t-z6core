import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tr } from "@/lib/ui-i18n";
import { DoctorRequisitionReview } from "@/components/doctor-requisition-review";

export const dynamic="force-dynamic";
export default async function DoctorRequisitionsPage({searchParams}:{
  searchParams:Promise<{page?:string}>,
}) {
  const session=await requirePermission("orders.view");
  const locale=session.user.preferredLocale==="ar"?"ar":"en";
  const organizationId=session.user.organizationId;
  const branchIds=session.user.branchScopes.filter(s=>
    s.branch.status==="ACTIVE"&&s.branch.organizationId===organizationId).map(s=>s.branchId);
  const raw=Number((await searchParams).page||"1");
  const requested=Number.isSafeInteger(raw)&&raw>=1&&raw<=10000?raw:1;
  const where={organizationId,branchId:{in:branchIds}};
  const total=await prisma.doctorRequisition.count({where});
  const pages=Math.max(1,Math.ceil(total/50));
  const page=Math.min(requested,pages);
  const rows=await prisma.doctorRequisition.findMany({
    where,orderBy:[{submittedAt:"desc"},{id:"desc"}],
    skip:(page-1)*50,take:50,
    include:{patient:{select:{patientNumber:true,fullNameEn:true,fullNameAr:true}},
      referrer:{select:{code:true,nameEn:true,nameAr:true}},
      branch:{select:{code:true,nameEn:true,nameAr:true}},
      items:{select:{testCodeSnapshot:true,testNameEnSnapshot:true,testNameArSnapshot:true}}},
  });
  return <main className="catalog-shell" dir={locale==="ar"?"rtl":"ltr"}>
    <header className="page-header"><div>
      <p className="eyebrow">{tr(locale,"Clinical Reception","الاستقبال السريري")}</p>
      <h1>{tr(locale,"Physician Electronic Requisitions","إحالات الأطباء الإلكترونية")}</h1>
      <p className="muted">{tr(locale,
        "Submitted requisitions are not clinical laboratory orders or invoices. Only authorized staff can register one through the full standard order workflow.",
        "الإحالات الإلكترونية ليست طلبات مخبرية أو فواتير. لا يسجلها كطلبات فعلية إلا موظف مخوّل عبر إجراءات التسجيل الاعتيادية.")}</p>
    </div><Link className="secondary-link" href="/orders">{tr(locale,"Orders","الطلبات")}</Link></header>
    <section className="workflow-summary"><article>
      <span>{tr(locale,"Branch-scoped requisitions","الإحالات ضمن صلاحيات الفروع")}</span>
      <strong>{total}</strong><small>{tr(locale,"All statuses","كل الحالات")}</small>
    </article></section>
    <DoctorRequisitionReview locale={locale} rows={rows.map(x=>({
      id:x.id,status:x.status,submittedAt:x.submittedAt.toISOString(),
      patient:x.patient.patientNumber+" — "+(locale==="ar"?x.patient.fullNameAr||x.patient.fullNameEn:x.patient.fullNameEn),
      branch:x.branch.code+" — "+(locale==="ar"?x.branch.nameAr||x.branch.nameEn:x.branch.nameEn),
      doctor:x.referrer.code+" — "+(locale==="ar"?x.referrer.nameAr||x.referrer.nameEn:x.referrer.nameEn),
      priority:x.priority,diagnosis:x.diagnosis,clinicalNotes:x.clinicalNotes,
      tests:x.items.map(i=>i.testCodeSnapshot+" — "+(locale==="ar"?i.testNameArSnapshot||i.testNameEnSnapshot:i.testNameEnSnapshot)),
      fulfilledOrderId:x.fulfilledOrderId,resolutionReason:x.resolutionReason,
    }))}/>
    <div className="inline-actions">
      {page>1&&<Link className="secondary-link" href={`/doctor-requisitions?page=${page-1}`}>
        {tr(locale,"Previous","السابق")}</Link>}
      <span>{page} / {pages}</span>
      {page<pages&&<Link className="secondary-link" href={`/doctor-requisitions?page=${page+1}`}>
        {tr(locale,"Next","التالي")}</Link>}
    </div>
  </main>;
}
