import Link from "next/link";
import { notFound } from "next/navigation";
import { permissionSet, requirePermission } from "@/lib/auth";
import { LegacyMasterDataImport } from "@/components/legacy-master-data-import";
import { LegacyMasterConfigurationExport } from "@/components/legacy-master-configuration-export";
import { tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function LegacyMasterDataPage() {
  const session = await requirePermission("catalog.manage");
  const grants = permissionSet(session);
  const kinds = [
    ...(grants.has("referrers.manage") ? ["REFERRER" as const] : []),
    ...(grants.has("sources.manage") ? ["SOURCE" as const] : []),
    ...(grants.has("microbiology.manage") ? ["ORGANISM" as const, "ANTIBIOTIC" as const] : []),
    ...(grants.has("clients.manage") ? ["CLIENT" as const] : []),
    ...(grants.has("result_comments.manage") ? ["COMMENT_TEMPLATE" as const] : []),
  ];
  if (kinds.length === 0 || !session.activeBranchId ||
    !session.user.branchScopes.some(scope => scope.branchId === session.activeBranchId &&
      scope.branch.status === "ACTIVE" && scope.branch.organizationId === session.user.organizationId)) {
    notFound();
  }
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Migration", "ترحيل البيانات")}</p>
        <h1>{tr(locale, "Legacy Reference Master Data", "البيانات المرجعية من النظام القديم")}</h1>
        <p className="muted">{tr(locale,
          "Safely import legacy reference masters and INACTIVE clinical comment templates without changing released results, contracts or financial balances.",
          "استيراد البيانات المرجعية وقوالب التعليقات السريرية غير المفعّلة دون تعديل النتائج الصادرة أو العقود أو الأرصدة المالية.")}</p>
      </div>
      <Link className="secondary-link" href="/catalog">{tr(locale, "Back to Catalog", "العودة للدليل")}</Link>
    </header>
    <p className="muted">{tr(locale, "Export audit timestamps are presented in UTC; signed manifests and imported source records remain unchanged.", "تُعرض أوقات التصدير بتوقيت UTC؛ لا تُعدّل ملفات التصدير الموقعة أو السجلات المصدرية.")}</p>
    <LegacyMasterConfigurationExport locale={locale} kinds={kinds}/>
    <LegacyMasterDataImport locale={locale} availableKinds={kinds}/>
  </main>;
}
