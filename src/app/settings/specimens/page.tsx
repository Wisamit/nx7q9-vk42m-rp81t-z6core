import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SpecimenRejectionReasonManager } from "@/components/specimen-rejection-reason-manager";
import { getUiLocale, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function SpecimenSettingsPage() {
  const session = await requirePermission("settings.manage");
  const locale = getUiLocale(session.user.preferredLocale);
  const reasons = await prisma.specimenRejectionReason.findMany({
    where: { organizationId: session.user.organizationId },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
  });

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Administration", "الإدارة")}</p>
        <h1>{tr(locale, "Specimen Settings", "إعدادات العينات")}</h1>
        <p className="muted">{tr(locale, "Configure rejection reasons used by specimen reception and recollection workflows. Existing rejection history keeps immutable snapshots.", "تهيئة أسباب الرفض المستخدمة في الاستلام وإعادة السحب. يحتفظ سجل الرفض القديم بنسخ تاريخية ثابتة.")}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/settings">{tr(locale, "System Settings", "إعدادات النظام")}</Link>
        <Link className="secondary-link" href="/specimens">{tr(locale, "Specimens", "العينات")}</Link>
      </div>
    </header>
    <SpecimenRejectionReasonManager
      locale={locale}
      reasons={reasons.map(item => ({
        id: item.id,
        code: item.code,
        nameEn: item.nameEn,
        nameAr: item.nameAr,
        sortOrder: item.sortOrder,
        status: item.status,
      }))}
    />
  </main>;
}
