import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { tr } from "@/lib/ui-i18n";
import { CatalogExpertReviewQueue } from "@/components/catalog-expert-review-queue";
import { CatalogPolicyDraftReviewQueue } from "@/components/catalog-policy-draft-review-queue";
import { F2ConfigurationApprovalForm } from "@/components/f2-configuration-approval-form";

import { F2ConfigurationOperationForm } from "@/components/f2-configuration-operation-form";

export const dynamic = "force-dynamic";

export default async function CatalogExpertReviewsPage() {
  const session = await requirePermission("catalog.manage");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const grants=permissionSet(session);
  const domains=(["CLINICAL","FINANCIAL"] as const).filter(domain=>
    grants.has(domain==="CLINICAL"?"catalog.configuration.clinical.sign":
      "catalog.configuration.financial.sign") &&
    grants.has(domain==="CLINICAL"?"catalog.reference_ranges.manage":"pricing.manage"));

  const operations=(["APPLY","REVERSE"] as const).filter(mode=>
    grants.has("pricing.manage") &&
    grants.has("catalog.reference_ranges.manage") &&
    grants.has(mode==="APPLY"?"catalog.configuration.apply":"catalog.configuration.reverse"));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Governed Configuration", "حوكمة الإعدادات")}</p>
        <h1>{tr(locale, "Independent Expert Review", "المراجعة المستقلة من المختص")}</h1>
        <p className="muted">{tr(locale,
          "Review differences and record separately authenticated technical sign-off decisions. Applying changes requires its own governed workflow.",
          "مراجعة الاختلافات وتسجيل قرارات التوقيع التقني المستقلة. تطبيق التغييرات يحتاج مساراً منفصلاً محكوماً بالصلاحيات.")}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/catalog">
          {tr(locale, "Back to Catalog", "العودة إلى دليل الفحوصات")}
        </Link>
      </div>
    </header>
    <p className="muted">{tr(locale, "Recorded review timestamps below are shown in UTC for audit consistency.", "تُعرض أوقات تسجيل المراجعات أدناه بتوقيت UTC لتتبع التدقيق.")}</p>
    <CatalogExpertReviewQueue locale={locale} />
    <CatalogPolicyDraftReviewQueue locale={locale} />
    {domains.length>0&&<F2ConfigurationApprovalForm locale={locale} allowedDomains={domains} />}
    {operations.length>0&&<F2ConfigurationOperationForm locale={locale} allowedModes={operations} />}
  </main>;
}
