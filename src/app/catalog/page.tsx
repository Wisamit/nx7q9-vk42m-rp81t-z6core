import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CatalogManager } from "@/components/catalog-manager";
import { ClinicalCatalogManager } from "@/components/clinical-catalog-manager";
import { LegacyImportBatches } from "@/components/legacy-import-batches";
import { CatalogConfigurationExport } from "@/components/catalog-configuration-export";
import { CatalogCsvReviewStaging } from "@/components/catalog-csv-review-staging";
import { CatalogBundleReviewStaging } from "@/components/catalog-bundle-review-staging";
import { CommercialPackageManager } from "@/components/commercial-package-manager";
import { statusLabel, tr } from "@/lib/ui-i18n";
import { resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { privateSpreadsheetBatchScope } from "@/lib/catalog-import-list-privacy";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const session = await requirePermission("catalog.view");
  const permissions = permissionSet(session);
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const canReviewPrices = permissions.has("catalog.manage") && permissions.has("pricing.manage");
  const activeBranches = session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE").map(scope => scope.branchId);
  const canReviewCsvRanges = permissions.has("catalog.reference_ranges.manage") &&
    resolveClinicalImportScope({
      organizationId: session.user.organizationId,
      activeBranchId: session.activeBranchId, activeBranch: session.activeBranch,
      branchScopes: session.user.branchScopes, departmentScopes: session.user.departmentScopes,
    }) !== null;
  const [tests, departments, specimens, containers, methods, units, analyzers, panels, packages, importBatches] = await Promise.all([
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
    prisma.analyzer.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, include: { branch: true }, orderBy: [{ branch: { nameEn: "asc" } }, { name: "asc" }] }),
    prisma.testPanel.findMany({ where: { organizationId: session.user.organizationId }, include: { items: true }, orderBy: { nameEn: "asc" } }),
    prisma.commercialPackage.findMany({ where: { organizationId: session.user.organizationId }, include: { items: { include: { test: true }, orderBy: { displayOrder: "asc" } }, priceListItems: {
      where: {
        status: "ACTIVE",
        priceList: {
          organizationId: session.user.organizationId,
          scopeType: { in: ["ORGANIZATION", "BRANCH"] },
          OR: [{ branchId: null }, { branchId: { in: activeBranches } }],
        },
        ...(canReviewPrices ? {} : { id: "00000000-0000-0000-0000-000000000000" }),
      },
      orderBy: { effectiveFrom: "desc" }, take: 1,
      include: { priceList: true },
    } }, orderBy: { nameEn: "asc" } }),
    prisma.catalogImportBatch.findMany({ where: {
      organizationId: session.user.organizationId,
      AND: [{
        OR: [
          { sourceType: { not: "CSV_REVIEW" } },
          { rows: { none: { entityType: "REFERENCE_INTERVAL" } } },
          ...(canReviewCsvRanges ? [{ createdByUserId: session.user.id }] : []),
        ],
      }, {
        // A CSV/XLSX or signed-bundle review batch is private to its author.
        // Its filename, row count and even existence are not a team-wide
        // catalog index; the detail page already applies the same author lock.
        ...privateSpreadsheetBatchScope(session.user.id),
      }],
      ...(permissions.has("catalog.manage") ? {
        OR: [
          { AND: [{ rows: { none: { entityType: "PRICE_LIST_ITEM" } } },
            { rows: { none: { entityType: "PRICE_LIST" } } },
            { rows: { none: { entityType: "PRICE_LIST_PACKAGE_ITEM" } } }] },
          ...(permissions.has("pricing.manage") ? [{ createdByUserId: session.user.id }] : []),
        ],
      } : { id: "00000000-0000-0000-0000-000000000000" }),
    }, include: { _count: { select: { rows: true } } }, orderBy: { createdAt: "desc" }, take: 10 }),
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
          <ClinicalCatalogManager
            locale={locale}
            tests={tests}
            units={units}
            methods={methods}
            branches={session.user.branchScopes.map(scope => scope.branch)}
            specimenTypes={specimens}
            analyzers={analyzers.map(analyzer => ({
              id: analyzer.id,
              code: analyzer.code,
              name: analyzer.name,
              branchId: analyzer.branchId,
              branchNameEn: analyzer.branch.nameEn,
              branchNameAr: analyzer.branch.nameAr,
            }))}
          />
          <CatalogManager locale={locale} departments={departments} specimens={specimens} containers={containers} methods={methods} units={units} />
          {permissions.has("catalog.manage") && <CommercialPackageManager locale={locale} tests={tests.map(test => ({ id: test.id, code: test.code, nameEn: test.nameEn, nameAr: test.nameAr }))} />}
          {permissions.has("catalog.manage") && <Link className="secondary-link" href="/catalog/imports/reconciliation-ledger">{tr(locale, "Legacy Migration Reconciliation", "مطابقة ترحيل Access")}</Link>}
          {permissions.has("catalog.manage") && <Link className="secondary-link" href="/catalog/expert-reviews">{tr(locale, "Independent Expert Reviews", "المراجعات المستقلة للمختصين")}</Link>}
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

      {permissions.has("catalog.manage") && <CatalogConfigurationExport locale={locale} canExportPricing={permissions.has("pricing.manage")} canExportRanges={canReviewCsvRanges} />}

      {permissions.has("catalog.manage") && <CatalogBundleReviewStaging locale={locale} />}

      {permissions.has("catalog.manage") && <CatalogCsvReviewStaging locale={locale} canStagePricing={permissions.has("pricing.manage")} canStageRanges={permissions.has("catalog.reference_ranges.manage")} />}

      {permissions.has("catalog.manage") &&
        (permissions.has("referrers.manage") || permissions.has("sources.manage") || permissions.has("microbiology.manage")) &&
        <section className="detail-card">
          <h2>{tr(locale, "Legacy Reference Master Migration", "ترحيل البيانات المرجعية القديمة")}</h2>
          <p className="muted">{tr(locale,
            "Import referrers, order sources, organisms and antibiotics from reviewed CSV files without overwriting existing codes.",
            "استيراد المحيلين ومصادر الطلبات والجراثيم والمضادات الحيوية عبر ملفات CSV مدققة دون استبدال الرموز الموجودة.")}</p>
          <Link className="secondary-link" href="/catalog/legacy-master-data">{tr(locale,
            "Open controlled master import", "فتح الاستيراد المرجعي المضبوط")}</Link>
        </section>}

      {permissions.has("catalog.manage") && <LegacyImportBatches locale={locale} batches={importBatches.map(batch => ({ id: batch.id, sourceName: batch.sourceName, sourceType: batch.sourceType, status: batch.status, rows: batch._count.rows, createdAt: batch.createdAt.toISOString() }))} />}

      <section className="table-card detail-section">
        <div className="table-toolbar"><h2>{tr(locale, "Commercial Packages", "الباقات التجارية")}</h2><span>{tr(locale, "Commercial groupings are separate from clinical panels.", "الباقات التجارية مستقلة عن الباقات السريرية.")}</span></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Tests", "الفحوصات")}</th>{canReviewPrices && <th>{tr(locale, "Latest configured price", "آخر سعر مهيأ")}</th>}<th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
            <tbody>
              {packages.length === 0 ? <tr><td colSpan={canReviewPrices ? 5 : 4} className="empty-state">{tr(locale, "No commercial packages configured.", "لا توجد باقات تجارية مهيأة.")}</td></tr> :
                packages.map(pkg => {
                  const price = pkg.priceListItems[0];
                  return <tr key={pkg.id}>
                    <td><strong>{pkg.code}</strong></td>
                    <td>{locale === "ar" ? pkg.nameAr || pkg.nameEn : pkg.nameEn}{pkg.nameAr && locale !== "ar" ? <><br/><small dir="rtl">{pkg.nameAr}</small></> : null}</td>
                    <td>{pkg.items.map(item => item.test.code).join(", ")}</td>
                    {canReviewPrices && <td>{price ? price.unitPrice.toString() + " " + price.priceList.currency + " · " + price.priceList.code : tr(locale, "Not priced", "غير مسعرة")}</td>}
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
