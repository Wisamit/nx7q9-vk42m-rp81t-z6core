import Link from "next/link";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DoctorPortalAccessManager } from "@/components/doctor-portal-access-manager";
import { tr } from "@/lib/ui-i18n";

export const dynamic="force-dynamic";
export default async function DoctorPortalAccessPage() {
 const session=await requirePermission("portal_accounts.manage");
 const org=session.user.organizationId,branchId=session.activeBranchId;
 if(!branchId||!session.user.branchScopes.some(s=>
   s.branchId===branchId&&s.branch.status==="ACTIVE"&&s.branch.organizationId===org))
   redirect("/dashboard?forbidden=1");
 const locale=session.user.preferredLocale==="ar"?"ar":"en";
 const [accounts,patients,grants]=await Promise.all([
  prisma.portalAccount.findMany({
   where:{organizationId:org,type:"DOCTOR",status:{not:"DISABLED"},
     referrer:{status:"ACTIVE",organizationId:org,type:"PHYSICIAN"}},
   include:{referrer:{select:{id:true,code:true,nameEn:true,nameAr:true}}},
   orderBy:{createdAt:"desc"},take:1000,
  }),
  prisma.patient.findMany({where:{organizationId:org,status:"ACTIVE"},
   select:{id:true,patientNumber:true,fullNameEn:true,fullNameAr:true},
   orderBy:{createdAt:"desc"},take:1000}),
  prisma.doctorPortalPatientAccess.findMany({where:{organizationId:org},
   include:{referrer:{select:{code:true,nameEn:true,nameAr:true}},
     patient:{select:{patientNumber:true,fullNameEn:true,fullNameAr:true}}},
   orderBy:{createdAt:"desc"},take:500}),
 ]);
 return <main className="catalog-shell">
  <header className="page-header"><div><h1>{tr(locale,"Doctor Portal Patient Access","صلاحيات الطبيب لمرضى بوابة الطبيب")}</h1>
   <p className="muted">{tr(locale,
    "Explicit patient authorization, independently scoped orders and reports, effective dates and audited immediate revocation.",
    "تفويض واضح لكل مريض وصلاحيات مستقلة للطلبات والتقارير مع تواريخ السريان والإلغاء الموثّق والفوري.")}</p>
  </div><Link className="secondary-link" href="/digital-services">{tr(locale,"Digital Services","الخدمات الرقمية")}</Link></header>
  <DoctorPortalAccessManager locale={locale}
   doctors={accounts.filter(x=>x.referrer).map(x=>({id:x.referrerId!,
     label:x.referrer!.code+" — "+(locale==="ar"?x.referrer!.nameAr||x.referrer!.nameEn:x.referrer!.nameEn)}))}
   patients={patients.map(x=>({id:x.id,
     label:x.patientNumber+" — "+(locale==="ar"?x.fullNameAr||x.fullNameEn:x.fullNameEn)}))}
   grants={grants.map(x=>({id:x.id,doctor:x.referrer.code+" — "+
      (locale==="ar"?x.referrer.nameAr||x.referrer.nameEn:x.referrer.nameEn),
    patient:x.patient.patientNumber+" — "+(locale==="ar"?x.patient.fullNameAr||x.patient.fullNameEn:x.patient.fullNameEn),
    orders:x.canViewOrders,reports:x.canViewReports,from:x.effectiveFrom.toISOString(),
    to:x.effectiveTo?.toISOString()??null,status:x.status,createdBy:x.createdByUserId,
    reason:x.reason,revokedAt:x.revokedAt?.toISOString()??null,revokeReason:x.revokeReason}))}/>
 </main>;
}
