import Link from "next/link";
import {permissionSet,requirePermission} from "@/lib/auth";
import {tr} from "@/lib/ui-i18n";
import {F2ConfigurationApprovalForm} from "@/components/f2-configuration-approval-form";

export const dynamic="force-dynamic";

/** Deliberately outside author-only /catalog/imports/:id page. */
export default async function ConfigurationApprovalsPage(){
  const session=await requirePermission("catalog.manage");
  const locale=session.user.preferredLocale==="ar"?"ar":"en";
  const grants=permissionSet(session);
  const domains=(["CLINICAL","FINANCIAL"] as const).filter(domain=>
    grants.has(domain==="CLINICAL"?
      "catalog.configuration.clinical.sign":
      "catalog.configuration.financial.sign") &&
    grants.has(domain==="CLINICAL"?
      "catalog.reference_ranges.manage":"pricing.manage"));
  return <main className="catalog-shell" dir={locale==="ar"?"rtl":"ltr"}>
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale,"Configuration governance","حوكمة الإعدادات")}</p>
        <h1>{tr(locale,"Independent configuration decisions","قرارات اعتماد الإعدادات المستقلة")}</h1>
        <p className="muted">{tr(locale,
          "Authorized clinical and financial reviewers must be separate from each other and from the source author.",
          "يجب فصل المراجع الطبي والمراجع المالي عن بعضهما وعن مُعدّ المصدر.")}</p>
      </div>
      <Link className="secondary-link" href="/catalog">
        {tr(locale,"Back to catalog","العودة إلى دليل الفحوصات")}
      </Link>
    </header>
    {domains.length?
      <F2ConfigurationApprovalForm locale={locale} allowedDomains={domains}/>:
      <section className="table-card detail-section">
        <p className="muted">{tr(locale,
          "This account has no independent clinical or financial signing permission. Your administrator can assign the appropriate scoped role later.",
          "هذا الحساب لا يملك صلاحية التوقيع الطبي أو المالي المستقل. يمكن إسناد الدور المناسب لاحقاً.")}</p>
      </section>}
  </main>;
}
