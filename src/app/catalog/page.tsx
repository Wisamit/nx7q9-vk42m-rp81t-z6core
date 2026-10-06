import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CatalogManager } from "@/components/catalog-manager";
import { ClinicalCatalogManager } from "@/components/clinical-catalog-manager";
import { LegacyImportBatches } from "@/components/legacy-import-batches";
import { CommercialPackageManager } from "@/components/commercial-package-manager";
import { statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const session = await requirePermission("catalog.view");
  const permissions = permissionSet(session);
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const [tests, departments, specimens, containers, methods, units, panels, packages, importBatches] = await Promise.all([
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId },
      include: { department: true, specimenType: true, components: { include: { unit: true, referenceIntervals: { orderBy: { effectiveFrom: "desc" }, take: 1 } }, orderBy: { displayOrder: "asc" } } },
      orderBy: { nameEn: "asc" },
    }),
    prisma.department.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }),
    prisma.specimenType.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }),
    prisma.container.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }),
    prisma.method.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }),
    prisma.unit.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, orderBy: { code: "asc" } }),
    prisma.testPanel.findMany({ where: { organizationId: session.user.organizationId }, include: { items: true }, orderBy: { nameEn: "asc" } }),
    prisma.commercialPackage.findMany({ where: { organizationId: session.user.organizationId }, include: { items: { include: { test: true }, orderBy: { displayOrder: "asc" } }, priceListItems: { where: { status: "ACTIVE" }, orderBy: { effectiveFrom: "desc" }, take: 1, include: { priceList: true } } }, orderBy: { nameEn: "asc" } }),
    prisma.catalogImportBatch.findMany({ where: { organizationId: session.user.organizationId }, include: { _count: { select: { rows: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  return (
    <main className="catalog-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">{tr(locale, "Master Data", "البيانات الرئيسية")}</p>
          <h1>{tr(locale, "Test Catalog", "دليل الفحوصات")}</h1>
          <p className="muted">{tr(locale, "Configuration-driven tests, components, specimens, methods and reference intervals.", "إدارة الفحوصات والمكونات والعينات والطرق والمجالات المرجعية بطريقة قابلة للتهيئة.")}</p>
        </div>
        <div className="header-actions">
          <ClinicalCatalogManager locale={locale} tests={tests} units={units} methods={methods} branches={session.user.branchScopes.map(scope => scope.branch)} />
          <CatalogManager locale={locale} departments={departments} specimens={specimens} containers={containers} methods={methods} units={units} />
          {permissions.has("catalog.manage") && <CommercialPackageManager locale={locale} tests={tests.map(test => ({ id: test.id, code: test.code, nameEn: test.nameEn, nameAr: test.nameAr }))} />}
          <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة إلى لوحة التحكم")}</Link>
        </div>
      </header>

      <section className="catalog-stats">
        <article><strong>{tests.length}</strong><span>{tr(locale, "Tests", "الفحوصات")}</span></article>
        <article><strong>{tests.filter(test => test.status === "ACTIVE").length}</strong><span>{tr(locale, "Active", "نشطة")}</span></article>
        <article><strong>{tests.reduce((sum, test) => sum + test.components.length, 0)}</strong><span>{tr(locale, "Components", "المكونات")}</span></article>
        <article><strong>{panels.length}</strong><span>{tr(locale, "Panels / Profiles", "الباقات السريرية / الملفات")}</span></article>
        <article><strong>{packages.length}</strong><span>{tr(locale, "Commercial Packages", "الباقات التجارية")}</span></article>
      </section>

      <LegacyImportBatches locale={locale} batches={importBatches.map(batch => ({ id: batch.id, sourceName: batch.sourceName, sourceType: batch.sourceType, status: batch.status, rows: batch._count.rows, createdAt: batch.createdAt.toISOString() }))} />

      <section className="table-card detail-section">
        <div className="table-toolbar"><h2>{tr(locale, "Commercial Packages", "الباقات التجارية")}</h2><span>{tr(locale, "Commercial groupings are separate from clinical panels.", "الباقات التجارية مستقلة عن الباقات السريرية.")}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Tests", "الفحوصات")}</th><th>{tr(locale, "Latest configured price", "آخر سعر مهيأ")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
            <tbody>
              {packages.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr(locale, "No commercial packages configured.", "لا توجد باقات تجارية مهيأة.")}</td></tr> :
                packages.map(pkg => {
                  const price = pkg.priceListItems[0];
                  return <tr key={pkg.id}>
                    <td><strong>{pkg.code}</strong></td>
                    <td>{locale === "ar" ? pkg.nameAr || pkg.nameEn : pkg.nameEn}{pkg.nameAr && locale !== "ar" ? <><br/><small dir="rtl">{pkg.nameAr}</small></> : null}</td>
                    <td>{pkg.items.map(item => item.test.code).join(", ")}</td>
                    <td>{price ? price.unitPrice.toString() + " " + price.priceList.currency + " · " + price.priceList.code : tr(locale, "Not priced", "غير مسعرة")}</td>
                    <td><span className={"status-badge status-" + pkg.status.toLowerCase()}>{statusLabel(locale, pkg.status)}</span></td>
                  </tr>;
                })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Tests", "الفحوصات")}</h2><span>{tr(locale, "Legacy catalog imports use controlled validation before committing data.", "يتم استيراد بيانات النظام القديم عبر تحقق مضبوط قبل اعتمادها في الدليل.")}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "English name", "الاسم بالإنجليزية")}</th><th>{tr(locale, "Arabic name", "الاسم بالعربية")}</th><th>{tr(locale, "Department", "القسم")}</th><th>{tr(locale, "Specimen", "العينة")}</th><th>{tr(locale, "Components", "المكونات")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
            <tbody>
              {tests.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr(locale, "No tests configured yet.", "لا توجد فحوصات مهيأة بعد.")}</td></tr> :
                tests.map(test => <tr key={test.id}>
                  <td><Link className="table-link" href={`/catalog/tests/${test.id}`}><strong>{test.code}</strong></Link></td>
                  <td><Link className="table-link" href={`/catalog/tests/${test.id}`}>{test.nameEn}</Link></td>
                  <td dir="rtl">{test.nameAr || "—"}</td>
                  <td>{locale === "ar" ? test.department?.nameAr || test.department?.nameEn || "—" : test.department?.nameEn || "—"}</td>
                  <td>{locale === "ar" ? test.specimenType?.nameAr || test.specimenType?.nameEn || "—" : test.specimenType?.nameEn || "—"}</td>
                  <td>{test.components.length}</td>
                  <td>{statusLabel(locale, test.status)}</td>
                </tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
