import Link from "next/link";
import {notFound} from "next/navigation";
import {permissionSet,requirePermission} from "@/lib/auth";
import {prisma} from "@/lib/db";
import {getUiLocale,tr,statusLabel} from "@/lib/ui-i18n";
import {
  buildDeliveryFollowupQueries,parseDeliveryFollowupFilters,
  deliveryFollowupHref,classifyDeliveryPromise,DELIVERY_QUEUE_PAGE_SIZE,
  type DeliveryFollowupStatus,
} from "@/lib/report-delivery-followup";

export const dynamic="force-dynamic";
type SearchParams=Promise<Record<string,string|string[]|undefined>>;
type QueueRow={
  orderId:string;accessionNumber:string;orderingBranchId:string;
  orderStatus:string;promisedUtc:Date;promisedLocal:string|null;
  promisedTimezone:string|null;currentReportStatus:string|null;reportIssuedAt:Date|null;
  currentStaffAttested:number;
};

const labels:Record<DeliveryFollowupStatus,{en:string;ar:string}>={
  PENDING:{en:"Pending final report",ar:"بانتظار التقرير النهائي"},
  OVERDUE:{en:"Overdue commitment",ar:"تجاوز الموعد المتفق عليه"},
  DUE_SOON:{en:"Due within 24 hours",ar:"خلال 24 ساعة"},
  FUTURE:{en:"Due later",ar:"موعد لاحق"},
  CURRENT_ISSUED:{en:"Current final/amended report issued",ar:"صدر التقرير النهائي/المعدل الحالي"},
  CURRENT_ISSUED_WITH_STAFF_ATTESTATION:{en:"Issued — staff handover attestation recorded",ar:"تقرير صادر — إقرار تسليم موظف مسجل"},
  CURRENT_ISSUED_NO_STAFF_ATTESTATION:{en:"Issued — no staff handover attestation",ar:"تقرير صادر — لا يوجد إقرار تسليم موظف"},
  ALL:{en:"All recorded promises",ar:"جميع المواعيد المسجلة"},
};
export default async function DeliveryQueuePage({searchParams}:{searchParams:SearchParams}){
  const session=await requirePermission("orders.view");
  // A report status is clinical information and requires both read permissions.
  if(!permissionSet(session).has("reports.view"))notFound();
  const locale=getUiLocale(session.user.preferredLocale);
  const organizationId=session.user.organizationId;
  const branchIds=[...new Set(session.user.branchScopes
    .filter(scope=>scope.branch.organizationId===organizationId)
    .map(scope=>scope.branchId))];
  const parsed=parseDeliveryFollowupFilters(await searchParams,branchIds);
  if(!parsed.ok)return <main className="catalog-shell">
    <header className="page-header">
      <div><h1>{tr(locale,"Invalid delivery follow-up filter","تصفية متابعة التسليم غير صالحة")}</h1>
        <p role="alert">{parsed.error==="branch_forbidden"?
          tr(locale,"You cannot view this branch.","لا يمكنك عرض هذا الفرع."):
          tr(locale,"Check the page and search parameters.","تحقق من رقم الصفحة ومعايير البحث.")}</p>
      </div>
      <Link className="secondary-link" href="/orders/delivery-queue">{tr(locale,"Clear filters","مسح التصفية")}</Link>
    </header>
  </main>;

  const filters=parsed.value;
  const nowUtc=new Date();
  const branches=branchIds.length?await prisma.branch.findMany({
    where:{organizationId,id:{in:branchIds}},
    select:{id:true,code:true,nameEn:true,nameAr:true},
    orderBy:{code:"asc"},
  }):[];
  const branchNames=new Map(branches.map(branch=>[
    branch.id,(locale==="ar"?branch.nameAr||branch.nameEn:branch.nameEn)+" ("+branch.code+")",
  ]));
  const query=branchIds.length?buildDeliveryFollowupQueries({
    organizationId,branchIds,filters,nowUtc,
  }):null;
  const counts=query?await prisma.$queryRawUnsafe<Array<{total:bigint}>>(
    query.count.sql,...query.count.params):[{total:BigInt(0)}];
  const total=Number(counts[0]?.total||BigInt(0));
  const pages=Math.max(1,Math.ceil(total/DELIVERY_QUEUE_PAGE_SIZE));
  const page=Math.min(filters.page,pages);
  const paged=branchIds.length?buildDeliveryFollowupQueries({
    organizationId,branchIds,filters:{...filters,page},nowUtc,
  }):null;
  const rows=paged?await prisma.$queryRawUnsafe<QueueRow[]>(
    paged.ids.sql,...paged.ids.params):[];

  const statusText=(status:DeliveryFollowupStatus)=>tr(locale,labels[status].en,labels[status].ar);
  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale,"Orders / Patient commitments","الطلبات / المواعيد المتفق عليها")}</p>
        <h1>{tr(locale,"Promised report delivery follow-up","متابعة مواعيد تسليم التقارير")}</h1>
        <p className="muted">{tr(locale,
          "Only staff-recorded promises are shown. Overdue means no CURRENT final/amended report has been issued by the promised instant. Issued does not mean printed, sent, received or acknowledged by the patient. Staff handover evidence is only a staff attestation for the current report version, not independent patient receipt.",
          "تُعرض المواعيد التي سجلها الموظف فقط. التأخر يعني عدم وجود إصدار نهائي/معدل حالي حتى الموعد المتفق عليه. صدور التقرير لا يعني طباعته أو إرساله أو استلام المريض له أو إقراره. سجل التسليم الحضوري هو إقرار موظف للإصدار الحالي، وليس إثبات استلام مستقل من المريض.")}</p>
      </div>
      <Link className="secondary-link" href="/orders">{tr(locale,"Back to orders","العودة للطلبات")}</Link>
    </header>
    <section className="table-card">
      <div className="table-toolbar">
        <h2>{tr(locale,"Filter commitments","تصفية المواعيد")}</h2>
        <Link className="secondary-link" href="/orders/delivery-queue">{tr(locale,"Reset","إعادة ضبط")}</Link>
      </div>
      <form className="catalog-form" method="get" action="/orders/delivery-queue">
        <label>{tr(locale,"Branch","الفرع")}
          <select name="branchId" defaultValue={filters.branchId}>
            <option value="">{tr(locale,"All authorized branches","جميع الفروع المسموح بها")}</option>
            {branches.map(branch=><option key={branch.id} value={branch.id}>{branchNames.get(branch.id)}</option>)}
          </select>
        </label>
        <label>{tr(locale,"Follow-up status","حالة المتابعة")}
          <select name="status" defaultValue={filters.status}>
            {(Object.keys(labels) as DeliveryFollowupStatus[]).map(status=><option key={status} value={status}>
              {statusText(status)}</option>)}
          </select>
        </label>
        <label>{tr(locale,"Accession (exact)","رقم الطلب (مطابقة تامة)")}
          <input name="accession" maxLength={50} defaultValue={filters.accession}
            placeholder={tr(locale,"Accession number","رقم الطلب")}/>
        </label>
        <button className="primary-button" type="submit">{tr(locale,"Apply","تطبيق")}</button>
      </form>
    </section>
    <section className="table-card detail-section">
      <div className="table-toolbar">
        <h2>{tr(locale,"Promised delivery follow-up","متابعة المواعيد المتفق عليها")}</h2>
        <span>{rows.length} {tr(locale,"shown","معروض")} · {total} {tr(locale,"matching","مطابق")}</span>
      </div>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr(locale,"Accession","رقم الطلب")}</th>
          <th>{tr(locale,"Ordering branch","فرع الطلب")}</th>
          <th>{tr(locale,"Patient promise (local snapshot)","الموعد المتفق عليه (التوقيت المحفوظ)")}</th>
          <th>{tr(locale,"Promise (UTC)","الموعد (UTC)")}</th>
          <th>{tr(locale,"Follow-up","المتابعة")}</th>
          <th>{tr(locale,"Latest report","آخر تقرير")}</th>
          <th>{tr(locale,"Current-version in-person handover audit","سجل التسليم الحضوري للإصدار الحالي")}</th>
          <th>{tr(locale,"Action","الإجراء")}</th>
        </tr></thead>
        <tbody>{rows.length===0?<tr><td colSpan={8} className="empty-state">
          {tr(locale,"No orders match the selected delivery follow-up.","لا توجد طلبات تطابق متابعة المواعيد المختارة.")}
        </td></tr>:rows.map(row=>{
          const follow=classifyDeliveryPromise({
            utc:row.promisedUtc,now:nowUtc,currentReportStatus:row.currentReportStatus,
          });
          const local=row.promisedLocal&&row.promisedTimezone?
            row.promisedLocal.replace("T"," ")+" ("+row.promisedTimezone+")":"—";
          return <tr key={row.orderId}>
            <td><strong>{row.accessionNumber}</strong></td>
            <td>{branchNames.get(row.orderingBranchId)||"—"}</td>
            <td>{local}</td>
            <td>{row.promisedUtc.toISOString().replace("T"," ").slice(0,19)}</td>
            <td>{statusText(follow)}</td>
            <td>{row.currentReportStatus?
              statusLabel(locale,row.currentReportStatus):
              tr(locale,"No report issued","لم يصدر تقرير")}</td>
            <td>{["FINAL","AMENDED"].includes(row.currentReportStatus||"")
              ? Number(row.currentStaffAttested)===1
                ? tr(locale,"Staff attestation recorded; patient receipt not independently verified",
                    "إقرار موظف مسجل؛ استلام المريض غير مؤكد بشكل مستقل")
                : tr(locale,"No in-person staff attestation for current report version",
                    "لا يوجد إقرار موظف للتسليم الحضوري للإصدار الحالي")
              : tr(locale,"Not applicable — no current final/amended report",
                  "غير منطبق — لا يوجد إصدار نهائي/معدل حالي")}</td>
            <td><Link className="secondary-link" href={"/orders/"+row.orderId}>
              {tr(locale,"Review order","مراجعة الطلب")}</Link>
              {row.currentReportStatus&&["FINAL","AMENDED"].includes(row.currentReportStatus)&&
                <Link className="secondary-link" href={"/reports/"+row.orderId}>
                  {tr(locale,"View issued report","عرض التقرير الصادر")}</Link>}
            </td>
          </tr>;
        })}</tbody>
      </table></div>
      <nav className="result-actions" aria-label={tr(locale,"Follow-up pages","صفحات المتابعة")}>
        {page>1&&<Link className="secondary-link" href={deliveryFollowupHref(filters,page-1)}>
          {tr(locale,"Previous","السابق")}</Link>}
        <span>{tr(locale,"Page","الصفحة")} {page} / {pages}</span>
        {page<pages&&<Link className="secondary-link" href={deliveryFollowupHref(filters,page+1)}>
          {tr(locale,"Next","التالي")}</Link>}
      </nav>
    </section>
  </main>;
}
