import Link from "next/link";
import { notFound } from "next/navigation";
import {
  authorizedDepartmentIds, canAccessBranch, permissionSet, requirePermission,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import { interpretationFingerprint } from "@/lib/report-interpretation";
import { ReportInterpretationManager } from "@/components/report-interpretation-manager";
import { tr } from "@/lib/ui-i18n";

export const dynamic="force-dynamic";
export default async function OrderReportInterpretationPage({
  params,
}: {params:Promise<{orderId:string}>}) {
  const session=await requirePermission("reports.view");
  const {orderId}=await params;
  const order=await prisma.labOrder.findFirst({
    where:{id:orderId,organizationId:session.user.organizationId},
    select:{id:true,accessionNumber:true,orderingBranchId:true,
      items:{where:{status:{not:"CANCELLED"}},
        select:{test:{select:{departmentId:true}}}},
      diagnosticReport:{select:{currentVersion:true}},
    },
  });
  if(!order||!canAccessBranch(session,order.orderingBranchId))notFound();
  const allowed=authorizedDepartmentIds(session);
  if(allowed.length&&order.items.some(i=>i.test.departmentId &&
    !allowed.includes(i.test.departmentId)))notFound();
  const [comments,count]=await Promise.all([
    prisma.reportInterpretiveComment.findMany({
      where:{organizationId:session.user.organizationId,orderId},
      include:{createdBy:{select:{displayNameEn:true,displayNameAr:true}}},
      orderBy:[{revisionNumber:"desc"}],take:100,
    }),
    prisma.reportInterpretiveComment.count({
      where:{organizationId:session.user.organizationId,orderId},
    }),
  ]);
  const locale=session.user.preferredLocale==="ar"?"ar":"en";
  const permissions=permissionSet(session);
  return <main className="catalog-shell">
    <header className="page-header">
      <div><p className="eyebrow">{tr(locale,"Clinical Reporting","التقارير السريرية")}</p>
        <h1>{tr(locale,"Report Interpretive Comments","التعليقات التفسيرية للتقرير")}</h1>
        <p className="muted">{tr(locale,
          "Clinical interpretation requires a separate author and reviewer. Only new report versions include newly approved text.",
          "يتطلب التفسير السريري مُنشئًا ومراجعًا مختلفين. تحتوي نسخ التقارير الجديدة فقط على النص الذي اعتُمد لاحقًا.")}</p>
      </div>
      <Link className="secondary-link" href={`/reports/${order.id}`}>
        {tr(locale,"Back to issued report","العودة للتقرير الصادر")}
      </Link>
    </header>
    {count>comments.length&&<p className="form-warning">{tr(locale,
      "Showing the latest 100 interpretations. Earlier immutable history remains in the audit log.",
      "تظهر أحدث 100 نسخة؛ السجل السابق محفوظ في سجل التدقيق.",
    )}</p>}
    <ReportInterpretationManager
      locale={locale} orderId={order.id} accession={order.accessionNumber}
      currentUserId={session.user.id}
      issuedVersion={order.diagnosticReport?.currentVersion??0}
      canAuthor={permissions.has("results.medical_validate")}
      canApprove={permissions.has("results.release")}
      notes={comments.map(c=>({
        id:c.id,revisionNumber:c.revisionNumber,status:c.status,
        textEn:c.textEn,textAr:c.textAr,
        createdBy:c.createdByUserId,
        createdAt:c.createdAt.toISOString(),
        reviewReason:c.reviewReason,fingerprint:interpretationFingerprint(c),
      }))}
    />
  </main>;
}
