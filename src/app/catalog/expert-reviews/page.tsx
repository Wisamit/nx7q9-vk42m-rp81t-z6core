import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { tr } from "@/lib/ui-i18n";
import { CatalogExpertReviewQueue } from "@/components/catalog-expert-review-queue";

export const dynamic = "force-dynamic";

export default async function CatalogExpertReviewsPage() {
  const session = await requirePermission("catalog.manage");
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Governed Configuration", "حوكمة الإعدادات")}</p>
        <h1>{tr(locale, "Independent Expert Review", "المراجعة المستقلة من المختص")}</h1>
        <p className="muted">{tr(locale,
          "Independent review of flagged catalog differences. No clinical or financial activation or approval is performed here.",
          "مراجعة مستقلة للاختلافات المحالة في إعدادات المختبر، دون إجراء اعتماد أو تفعيل لأي قيم طبية أو مالية.")}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/catalog">
          {tr(locale, "Back to Catalog", "العودة إلى دليل الفحوصات")}
        </Link>
      </div>
    </header>
    <CatalogExpertReviewQueue locale={locale} />
  </main>;
}
