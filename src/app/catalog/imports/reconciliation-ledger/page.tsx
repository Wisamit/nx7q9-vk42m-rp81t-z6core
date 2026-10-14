import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { tr } from "@/lib/ui-i18n";
import { LegacyImportReconciliationLedger } from "@/components/legacy-import-reconciliation-ledger";
import { LegacySourceCoverageReview } from "@/components/legacy-source-coverage-review";

export const dynamic = "force-dynamic";

export default async function LegacyReconciliationPage() {
  const session=await requirePermission("catalog.manage");
  const locale=session.user.preferredLocale==="ar"?"ar":"en";
  return <main className="catalog-shell" dir={locale==="ar"?"rtl":"ltr"}>
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale,"Legacy Access migration","ترحيل قاعدة Access القديمة")}</p>
        <h1>{tr(locale,"Source-to-Import Reconciliation Ledger","سجل مطابقة مصادر الترحيل")}</h1>
        <p className="muted">{tr(locale,
          "Review recorded staging batches, unresolved candidates and exceptions. Clinical and financial approvals must be completed separately.",
          "راجع دفعات التجهيز المسجلة والصفوف غير المحسومة والاستثناءات. اعتماد البيانات الطبية والمالية يتم بشكل مستقل.")}</p>
      </div>
      <Link href="/catalog" className="secondary-link">{tr(locale,"Back to catalog","العودة إلى الدليل")}</Link>
    </header>
    <LegacySourceCoverageReview locale={locale}/>
    <LegacyImportReconciliationLedger locale={locale}/>
  </main>;
}
