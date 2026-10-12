import Link from "next/link";
import {notFound} from "next/navigation";
import {requirePermission} from "@/lib/auth";
import {prisma} from "@/lib/db";
import {getUiLocale,tr} from "@/lib/ui-i18n";
export const dynamic="force-dynamic";
const PAGE_SIZE=50;
function pageNum(v:string|undefined){const n=Number(v||"1");return Number.isSafeInteger(n)&&n>0&&n<=100000?n:1;}
export default async function LotImpactPage({params,searchParams}:{
 params:Promise<{lotId:string}>;
 searchParams:Promise<{page?:string}>;
}){
 const session=await requirePermission("inventory.view");
 const locale=getUiLocale(session.user.preferredLocale);
 const {lotId}=await params,{page:rawPage}=await searchParams;
 const page=pageNum(rawPage);
 const organizationId=session.user.organizationId;
 const allowedBranches=[...new Set(session.user.branchScopes.filter(s=>
   s.branch.organizationId===organizationId&&s.branch.status==="ACTIVE")
   .map(s=>s.branchId))];
 // Read access is strictly branch-scoped. An organization-wide recall does
 // not grant the actor access to every branch's traceability or patient data.
 const lot=await prisma.inventoryLot.findFirst({
   where:{id:lotId,organizationId,OR:[
     {branchStocks:{some:{branchId:{in:allowedBranches}}}},
     {movements:{some:{organizationId,branchId:{in:allowedBranches}}}},
     {transferItems:{some:{transfer:{organizationId,OR:[
       {sourceBranchId:{in:allowedBranches}},
       {destinationBranchId:{in:allowedBranches}},
     ]}}}},
     {qcLots:{some:{targets:{some:{results:{some:{
       run:{organizationId,branchId:{in:allowedBranches}},
     }}}}}}},
   ]},
   include:{item:{select:{code:true,nameEn:true,nameAr:true,stockUnit:true}},
     safetyEvents:{orderBy:[{createdAt:"desc"},{id:"desc"}],take:1}},
 });
 if(!lot)notFound();
 const movementFilter={organizationId,lotId,branchId:{in:allowedBranches}};
 const transferFilter={lotId,transfer:{organizationId,OR:[
   {sourceBranchId:{in:allowedBranches}},{destinationBranchId:{in:allowedBranches}},
 ]}};
 const [stocks,counts,movements,transfers,qcResults]=await Promise.all([
   prisma.inventoryLotStock.findMany({where:{lotId,branchId:{in:allowedBranches}},
     include:{branch:{select:{code:true,nameEn:true,nameAr:true}}},orderBy:{branchId:"asc"}}),
   Promise.all([
     prisma.stockMovement.count({where:movementFilter}),
     prisma.inventoryTransferItem.count({where:transferFilter}),
     prisma.qcResult.count({where:{target:{qcLot:{inventoryLotId:lotId,organizationId}},
       run:{organizationId,branchId:{in:allowedBranches}}}}),
   ]),
   prisma.stockMovement.findMany({where:movementFilter,
     orderBy:[{occurredAt:"desc"},{id:"desc"}],skip:(page-1)*PAGE_SIZE,take:PAGE_SIZE,
     include:{branch:{select:{code:true}},actor:{select:{displayNameEn:true,displayNameAr:true}}}}),
   prisma.inventoryTransferItem.findMany({where:transferFilter,
     include:{transfer:{select:{transferNumber:true,status:true,sourceBranchId:true,
       destinationBranchId:true,requestedAt:true,
       sourceBranch:{select:{code:true}},destinationBranch:{select:{code:true}}}}},
     orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(page-1)*PAGE_SIZE,take:PAGE_SIZE}),
   prisma.qcResult.findMany({where:{target:{qcLot:{inventoryLotId:lotId,organizationId}},
      run:{organizationId,branchId:{in:allowedBranches}}},
     include:{run:{select:{runAt:true,status:true,branch:{select:{code:true}}}},
       target:{select:{id:true}}},
     orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(page-1)*PAGE_SIZE,take:PAGE_SIZE}),
 ]);
 const [movementTotal,transferTotal,qcTotal]=counts;
const maxPages=Math.max(1,Math.ceil(Math.max(...counts)/PAGE_SIZE));
 const effectivePage=Math.min(page,maxPages);
 // Outbound transfers include the partner branch's code but never disclose its
 // private stock ledger or user data without that branch's own scope.
 const localized=(a:{nameEn:string;nameAr:string|null})=>locale==="ar"?a.nameAr||a.nameEn:a.nameEn;
 return <main className="catalog-shell">
  <header className="page-header">
   <div><p className="eyebrow">{tr(locale,"Inventory Recall Investigation","تحقيق أثر استدعاء مخزون")}</p>
   <h1>{tr(locale,"Lot impact trace","تتبع أثر التشغيلة")}: {lot.lotNumber}</h1>
   <p>{lot.item.code} — {localized(lot.item)} · {lot.safetyStatus}</p></div>
   <Link className="secondary-link" href="/inventory/operations">{tr(locale,"Back to inventory","العودة للمخزون")}</Link>
  </header>
  <section className="detail-card">
    <h2>{tr(locale,"Review limitations","حدود التحقيق")}</h2>
    <p>{tr(locale,
      "Read-only, branch-scoped evidence. Movement and QC links do not prove which patient or released test used this lot. A qualified quality investigation must verify clinical impact before notifications or report amendments.",
      "أدلة للقراءة فقط ضمن الفروع المصرح بها. حركات المخزون وارتباطات ضبط الجودة لا تثبت أي مريض أو نتيجة استخدمت التشغيلة. يجب على مسؤول الجودة التحقق من الأثر السريري قبل أي إخطار أو تعديل تقرير.")}</p>
    <p>{tr(locale,"Last safety decision","آخر قرار سلامة")}: {lot.safetyEvents[0]?.nextStatus||"—"} · {lot.safetyEvents[0]?.createdAt.toISOString().slice(0,19)||"—"}</p>
    <p>{tr(locale,"Visible evidence counts","عدد الأدلة الظاهرة")}: {movementTotal} {tr(locale,"movements","حركة")} · {transferTotal} {tr(locale,"transfers","تحويل")} · {qcTotal} QC</p>
  </section>
  <section className="table-card detail-section"><h2>{tr(locale,"Authorized branch balances","الأرصدة ضمن الفروع المصرح بها")}</h2>
   <div className="table-wrap"><table><thead><tr><th>{tr(locale,"Branch","الفرع")}</th><th>{tr(locale,"On hand","المتوفر")}</th><th>{tr(locale,"Reserved","المحجوز")}</th></tr></thead>
   <tbody>{stocks.map(x=><tr key={x.id}><td>{x.branch.code}</td><td>{x.quantityOnHand.toString()}</td><td>{x.reservedQty.toString()}</td></tr>)}</tbody></table></div>
  </section>
  <section className="table-card detail-section"><h2>{tr(locale,"Historical movements","الحركات التاريخية")} ({movementTotal})</h2>
   <div className="table-wrap"><table><thead><tr><th>{tr(locale,"Time","الوقت")}</th><th>{tr(locale,"Branch","الفرع")}</th><th>{tr(locale,"Type","النوع")}</th><th>{tr(locale,"Quantity","الكمية")}</th><th>{tr(locale,"Source reference","مرجع المصدر")}</th></tr></thead>
   <tbody>{movements.map(x=><tr key={x.id}><td>{x.occurredAt.toISOString().slice(0,19)}</td><td>{x.branch.code}</td><td>{x.movementType}</td><td>{x.quantity.toString()}</td><td>{x.referenceType||"—"} {x.referenceId||""}</td></tr>)}</tbody></table></div>
  </section>
  <section className="table-card detail-section"><h2>{tr(locale,"Transfer custody","سجل نقل التشغيلة")} ({transferTotal})</h2>
   <div className="table-wrap"><table><thead><tr><th>{tr(locale,"Number","الرقم")}</th><th>{tr(locale,"From / to","من / إلى")}</th><th>{tr(locale,"Status","الحالة")}</th><th>{tr(locale,"Dispatched","المرسل")}</th><th>{tr(locale,"Received","المستلم")}</th></tr></thead><tbody>
   {transfers.map(x=><tr key={x.id}><td>{x.transfer.transferNumber}</td><td>{x.transfer.sourceBranch.code} → {x.transfer.destinationBranch.code}</td><td>{x.transfer.status}</td><td>{x.dispatchedQty?.toString()||"—"}</td><td>{x.receivedQty?.toString()||"—"}</td></tr>)}
   </tbody></table></div>
  </section>
  <section className="table-card detail-section"><h2>{tr(locale,"Linked quality-control results","نتائج ضبط الجودة المرتبطة")} ({qcTotal})</h2>
   <div className="table-wrap"><table><thead><tr><th>{tr(locale,"Run time","وقت التشغيل")}</th><th>{tr(locale,"Branch","الفرع")}</th><th>{tr(locale,"QC status","حالة QC")}</th><th>{tr(locale,"Result","النتيجة")}</th></tr></thead><tbody>
   {qcResults.map(x=><tr key={x.id}><td>{x.run.runAt.toISOString().slice(0,19)}</td><td>{x.run.branch.code}</td><td>{x.status}</td><td>{x.observedValue.toString()}</td></tr>)}
   </tbody></table></div>
  </section>
  <nav className="inline-actions">
   {page>1&&<Link className="secondary-link" href={`/inventory/lot-impact/${lotId}?page=${effectivePage-1}`}>{tr(locale,"Previous","السابق")}</Link>}
   <span>{tr(locale,"Page","صفحة")} {effectivePage} / {maxPages}</span>
   {page<maxPages&&<Link className="secondary-link" href={`/inventory/lot-impact/${lotId}?page=${effectivePage+1}`}>{tr(locale,"Next","التالي")}</Link>}
  </nav>
 </main>;
}
