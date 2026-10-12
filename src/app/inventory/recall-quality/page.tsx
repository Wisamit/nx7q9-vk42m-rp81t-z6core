import Link from "next/link";
import {requirePermission,permissionSet} from "@/lib/auth";
import {prisma} from "@/lib/db";
import {getUiLocale,tr} from "@/lib/ui-i18n";
export const dynamic="force-dynamic";
const SIZE=40;
function selectedPage(value:string|undefined){
 const n=Number(value||"1");return Number.isSafeInteger(n)&&n>0&&n<=10000?n:1;
}
function selectedState(value:string|undefined){
 return value==="ALL"?"ALL":"OPEN";
}
export default async function RecallQualityFollowupPage({searchParams}:{
 searchParams:Promise<{page?:string;state?:string}>;
}){
 const session=await requirePermission("inventory.view");
 const grants=permissionSet(session);
 if(!grants.has("quality.nonconformance.manage")){
  return <main className="catalog-shell"><h1>{tr(getUiLocale(session.user.preferredLocale),
    "Quality management permission required","صلاحية إدارة الجودة مطلوبة")}</h1></main>;
 }
 const locale=getUiLocale(session.user.preferredLocale);
 const {page:rawPage,state:rawState}=await searchParams;
 const page=selectedPage(rawPage),state=selectedState(rawState);
 const org=session.user.organizationId;
 const permitted=[...new Set(session.user.branchScopes.filter(x=>
   x.branch.organizationId===org&&x.branch.status==="ACTIVE").map(x=>x.branchId))];
 // Access is scoped to the user's real, currently active memberships.
 // Quality cases from any other tenant or unassigned branch are excluded.
 const where={organizationId:org,branchId:{in:permitted},
   ...(state==="OPEN"?{nonconformance:{status:{notIn:["CLOSED" as const,"CANCELLED" as const]}}}:{})};
 const [total,rows,openTotal,closedTotal]=await Promise.all([
   prisma.inventoryLotQualityCase.count({where}),
   prisma.inventoryLotQualityCase.findMany({where,
     orderBy:[{createdAt:"desc"},{id:"desc"}],
     skip:(page-1)*SIZE,take:SIZE,
     select:{id:true,createdAt:true,lotId:true,branchId:true,safetyEventId:true,
       branch:{select:{code:true,nameEn:true,nameAr:true}},
       lot:{select:{lotNumber:true,safetyStatus:true,
         item:{select:{code:true,nameEn:true,nameAr:true}}}},
       nonconformance:{select:{id:true,caseNumber:true,title:true,status:true,severity:true,
         detectedAt:true,closedAt:true,owner:{select:{displayNameEn:true,displayNameAr:true}}}},
     }}),
   prisma.inventoryLotQualityCase.count({where:{organizationId:org,branchId:{in:permitted},
     nonconformance:{status:{notIn:["CLOSED","CANCELLED"]}}}}),
   prisma.inventoryLotQualityCase.count({where:{organizationId:org,branchId:{in:permitted},
     nonconformance:{status:{in:["CLOSED","CANCELLED"]}}}}),
 ]);
 const last=Math.max(1,Math.ceil(total/SIZE));
 const url=(n:number)=>"/inventory/recall-quality?state="+state+"&page="+n;
 const stateUrl=(st:"ALL"|"OPEN")=>"/inventory/recall-quality?state="+st+"&page=1";
 const local=(v:{nameEn:string;nameAr:string|null})=>locale==="ar"?v.nameAr||v.nameEn:v.nameEn;
 return <main className="catalog-shell">
  <header className="page-header">
   <div><p className="eyebrow">{tr(locale,"Quality follow-up","متابعة الجودة")}</p>
    <h1>{tr(locale,"Inventory Recall — Quality Follow-up Queue",
      "متابعة حالات الجودة لاستدعاءات المخزون")}</h1>
    <p className="muted">{tr(locale,
      "Read-only overview of linked quality cases in your authorized branches. Formal investigation and closure remain in Quality Management.",
      "عرض للقراءة فقط لقضايا الجودة المرتبطة بالتشغيلات ضمن فروعك المصرّح بها. التحقيق والإغلاق يتمان داخل نظام إدارة الجودة.")}</p>
   </div><div className="result-actions">
    <Link href="/inventory/operations" className="secondary-link">{tr(locale,"Inventory operations","عمليات المخزون")}</Link>
    <Link href="/quality" className="secondary-link">{tr(locale,"Quality management","إدارة الجودة")}</Link>
   </div>
  </header>
  <section className="finance-kpi-grid">
   <article><div><span>{tr(locale,"Open / in progress","مفتوحة / قيد المعالجة")}</span></div>
    <strong>{openTotal}</strong></article>
   <article><div><span>{tr(locale,"Closed / cancelled","مغلقة / ملغاة")}</span></div>
    <strong>{closedTotal}</strong></article>
  </section>
  <section className="table-card detail-section">
   <div className="table-toolbar"><h2>{tr(locale,"Linked investigation cases","قضايا التحقيق المرتبطة")}</h2>
    <div className="inline-actions">
     <Link className="secondary-link" href={stateUrl("OPEN")}>{tr(locale,"Active cases","القضايا النشطة")}</Link>
     <Link className="secondary-link" href={stateUrl("ALL")}>{tr(locale,"All cases","كل القضايا")}</Link>
    </div>
   </div>
   <div className="table-wrap"><table>
    <thead><tr>
     <th>{tr(locale,"Created","التاريخ")}</th><th>{tr(locale,"Branch","الفرع")}</th>
     <th>{tr(locale,"Lot / item","التشغيلة / المادة")}</th>
     <th>{tr(locale,"Quality case","قضية الجودة")}</th>
     <th>{tr(locale,"Severity","الخطورة")}</th><th>{tr(locale,"Case status","حالة القضية")}</th>
     <th>{tr(locale,"Owner","المسؤول")}</th><th>{tr(locale,"Evidence","الأدلة")}</th>
    </tr></thead>
    <tbody>{rows.length===0?<tr><td colSpan={8} className="empty-state">{tr(locale,
     "No linked recall investigations within your authorized branches.","لا توجد قضايا استدعاء مرتبطة ضمن الفروع المصرح بها.")}</td></tr>:
     rows.map(row=><tr key={row.id}>
      <td>{row.createdAt.toISOString().slice(0,16).replace("T"," ")}</td>
      <td>{row.branch.code} · {local(row.branch)}</td>
      <td>{row.lot.lotNumber} · {row.lot.item.code} · {local(row.lot.item)}</td>
      <td><strong>{row.nonconformance.caseNumber}</strong>
       <div className="table-subtext">{row.nonconformance.title}</div></td>
      <td>{row.nonconformance.severity}</td><td>{row.nonconformance.status}</td>
      <td>{row.nonconformance.owner?local(row.nonconformance.owner):"—"}</td>
      <td><Link href={"/inventory/lot-impact/"+row.lotId} className="secondary-link">
       {tr(locale,"Lot evidence","أدلة التشغيلة")}</Link></td>
     </tr>)}</tbody>
   </table></div>
   <div className="result-actions">
    {page>1&&<Link href={url(page-1)} className="secondary-link">{tr(locale,"Previous","السابق")}</Link>}
    <span>{tr(locale,"Page","الصفحة")} {page} / {last} · {total} {tr(locale,"records","سجل")}</span>
    {page<last&&<Link href={url(page+1)} className="secondary-link">{tr(locale,"Next","التالي")}</Link>}
   </div>
   <p className="muted">{tr(locale,
    "A quality case does not prove patient exposure, physical disposal or release from quarantine. The source recall and clinical histories are unchanged.",
    "فتح قضية جودة لا يثبت تعرض مريض ولا إتلافًا فعليًا ولا رفعًا للحجر. سجل الاستدعاء والتاريخ السريري لا يتغيران.")}</p>
  </section>
 </main>;
}
