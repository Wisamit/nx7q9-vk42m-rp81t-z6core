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
 // Unlinked escalations are actionable only while the source lot still
 // belongs to the latest held safety event. Older recalls never reopen work.
 // This is a bounded recent-work sample, not an invented organization-wide total.
 const escalations=await prisma.inventoryLotBranchResponse.findMany({
   where:{organizationId:org,branchId:{in:permitted},action:"ESCALATED_TO_QUALITY",
     lot:{organizationId:org,status:"ACTIVE",safetyStatus:{in:["QUARANTINED","RECALLED"]}},
     safetyEvent:{organizationId:org,nextStatus:{in:["QUARANTINED","RECALLED"]}}},
   orderBy:[{createdAt:"desc"},{id:"desc"}],
   take:200,
   select:{id:true,branchId:true,safetyEventId:true,createdAt:true,note:true,
     branch:{select:{code:true,nameEn:true,nameAr:true}},
     lot:{select:{id:true,lotNumber:true,safetyStatus:true,
       item:{select:{code:true,nameEn:true,nameAr:true}},
       safetyEvents:{where:{organizationId:org},orderBy:[{createdAt:"desc"},{id:"desc"}],
         take:1,select:{id:true}}}},
     safetyEvent:{select:{qualityCases:{where:{organizationId:org},
       select:{branchId:true}}}},
   },
 });
 const pending=escalations.filter(item=>
   item.lot.safetyEvents[0]?.id===item.safetyEventId &&
   !item.safetyEvent.qualityCases.some(link=>link.branchId===item.branchId)).slice(0,40);
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
  <section className="table-card detail-section">
   <div className="table-toolbar">
    <h2>{tr(locale,"Pending escalations requiring a quality case",
      "تصعيدات بانتظار فتح قضية جودة")}</h2>
    <span>{pending.length} {tr(locale,"recent actionable items","حالة حديثة قابلة للمتابعة")}</span>
   </div>
   <p className="muted">{tr(locale,
     "Recent unlinked branch escalations for the latest quarantine/recall event. Only the active branch can formally open a case; switch the active branch before using the source link if necessary. This is a bounded recent list, not a complete backlog total.",
     "تصعيدات حديثة لم تُربط بعد بقضية جودة وتخص آخر حدث حجر أو استدعاء. فتح القضية متاح للفرع النشط فقط؛ غيّر الفرع النشط قبل متابعة الرابط عند الحاجة. هذه قائمة محدودة للحالات الحديثة وليست إجمالي المتأخرات.")}</p>
   <div className="table-wrap"><table>
    <thead><tr><th>{tr(locale,"Escalated","تاريخ التصعيد")}</th>
     <th>{tr(locale,"Branch","الفرع")}</th><th>{tr(locale,"Lot / item","التشغيلة / المادة")}</th>
     <th>{tr(locale,"Current hold","حالة الحجر الحالية")}</th>
     <th>{tr(locale,"Investigation evidence","ملاحظة التصعيد")}</th>
     <th>{tr(locale,"Next action","الإجراء التالي")}</th></tr></thead>
    <tbody>{pending.length===0?<tr><td colSpan={6} className="empty-state">{tr(locale,
      "No actionable unlinked escalations found in recent records.",
      "لا توجد تصعيدات غير مرتبطة قابلة للمتابعة ضمن السجلات الحديثة.")}</td></tr>:
     pending.map(item=><tr key={item.id}>
      <td>{item.createdAt.toISOString().slice(0,16).replace("T"," ")}</td>
      <td>{item.branch.code} · {local(item.branch)}</td>
      <td><strong>{item.lot.lotNumber}</strong> · {item.lot.item.code}
       <div className="table-subtext">{local(item.lot.item)}</div></td>
      <td>{item.lot.safetyStatus}</td>
      <td>{item.note.slice(0,180)}</td>
      <td><Link href={"/inventory/lot-impact/"+item.lot.id} className="secondary-link">
       {tr(locale,"Review / open quality case","مراجعة / فتح قضية جودة")}</Link></td>
     </tr>)}</tbody>
   </table></div>
  </section>
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
