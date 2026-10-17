import Link from "next/link";
import { notFound } from "next/navigation";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SafeImportButton } from "@/components/safe-import-button";
import { SystemDateText } from "@/components/system-date-text";
import { RevalidateImportButton } from "@/components/revalidate-import-button";
import { ReferenceRangeImportButton } from "@/components/reference-range-import-button";
import { ComponentImportReconciliation } from "@/components/component-import-reconciliation";
import { PriceImportReconciliation } from "@/components/price-import-reconciliation";
import { ReferenceRangeImportReconciliation } from "@/components/reference-range-import-reconciliation";
import { getUiLocale, tr } from "@/lib/ui-i18n";
import { authorizedStagedPrices, stagedPriceListCode, stagedPriceTestCode } from "@/lib/catalog-import-disclosure";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { BUNDLE_REVIEW_SOURCE } from "@/lib/catalog-bundle-review";
import { CatalogBundleDriftReview } from "@/components/catalog-bundle-drift-review";
import { CatalogGovernanceReadiness } from "@/components/catalog-governance-readiness";

export const dynamic = "force-dynamic";

type RowStatus = "VALID" | "WARNING" | "ERROR" | "IMPORTED" | "SKIPPED";

function issueCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const code = (item as Record<string, unknown>).code;
    return typeof code === "string" ? [code] : [];
  });
}

export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requirePermission("catalog.manage");
  const locale = getUiLocale(session.user.preferredLocale);
  const permissions = permissionSet(session);
  const { id } = await params;
  const query = await searchParams;
  const requested = query.status?.toUpperCase();
  const status = ["VALID", "WARNING", "ERROR", "IMPORTED", "SKIPPED"].includes(requested || "")
    ? requested as RowStatus
    : undefined;

  const batch = await prisma.catalogImportBatch.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!batch) notFound();
  const isBundleReview = batch.sourceType === BUNDLE_REVIEW_SOURCE;
  const bundleSummary = batch.summary && typeof batch.summary === "object" &&
    !Array.isArray(batch.summary) ? batch.summary as Record<string, unknown> : {};
  const bundleAttested = bundleSummary.attestationStatus === "VERIFIED";
  if (isBundleReview) {
    // Source documents can expose confidential clinical and financial context.
    // Re-check current author, branch, department and financial grants BEFORE
    // loading original normalized source data for display.
    if (batch.createdByUserId !== session.user.id) notFound();
    const scoped = resolveClinicalImportScope({
      organizationId: session.user.organizationId,
      activeBranchId: session.activeBranchId, activeBranch: session.activeBranch,
      branchScopes: session.user.branchScopes, departmentScopes: session.user.departmentScopes,
    });
    if (!scoped) notFound();
    const authorBranches = new Set(session.user.branchScopes.filter(b =>
      b.branch.status === "ACTIVE" && b.branch.organizationId === session.user.organizationId)
      .map(b => b.branchId));
    const candidates = await prisma.catalogImportRow.findMany({
      where: { batchId: batch.id },
      select: { entityType: true, normalizedData: true },
    });
    if (candidates.some(c => c.entityType.startsWith("PRICE_")) && !permissions.has("pricing.manage")) notFound();
    if (candidates.some(c => c.entityType === "REFERENCE_INTERVAL") &&
        !permissions.has("catalog.reference_ranges.manage")) notFound();
    const ids = new Set<string>();
    const components = new Set<string>();
    const lists = new Set<string>();
    const panels = new Set<string>();
    const packages = new Set<string>();
    for (const candidate of candidates) {
      const d = candidate.normalizedData;
      if (!d || typeof d !== "object" || Array.isArray(d)) notFound();
      const branchId = typeof d.branchId === "string" ? d.branchId : null;
      if (branchId && !authorBranches.has(branchId)) notFound();
      if (candidate.entityType === "TEST") ids.add(String(d.id));
      if (candidate.entityType === "PANEL" || candidate.entityType === "PACKAGE") {
        if (!Array.isArray(d.items) || !d.items.length) notFound();
        for (const member of d.items) {
          if (!member || typeof member !== "object" || Array.isArray(member) ||
              typeof member.testId !== "string") notFound();
          ids.add(member.testId);
        }
        if (candidate.entityType === "PANEL") panels.add(String(d.id));
        else packages.add(String(d.id));
      }
      if (candidate.entityType === "PRICE_LIST_PACKAGE_ITEM") {
        if (typeof d.priceListId !== "string" || typeof d.packageId !== "string") notFound();
        lists.add(d.priceListId);
        packages.add(d.packageId);
      }
      if (candidate.entityType === "COMPONENT" || candidate.entityType === "PRICE_LIST_ITEM") {
        ids.add(String(d.testId));
      }
      if (candidate.entityType === "COMPONENT" || candidate.entityType === "REFERENCE_INTERVAL") {
        if (candidate.entityType === "REFERENCE_INTERVAL") components.add(String(d.componentId));
      }
      if (candidate.entityType === "PRICE_LIST_ITEM") lists.add(String(d.priceListId));
      if (candidate.entityType === "PRICE_LIST") lists.add(String(d.id));
    }
    const testWhere = { ...clinicalImportTestWhere(scoped), status: undefined };
    if (ids.size) {
      const allowed = await prisma.labTest.count({ where: { ...testWhere, id: { in: [...ids] } } });
      if (allowed !== ids.size) notFound();
    }
    if (panels.size) {
      const allowed = await prisma.testPanel.count({
        where: { id: { in: [...panels] }, organizationId: session.user.organizationId,
          items: { some: { test: testWhere }, every: { test: testWhere } } },
      });
      if (allowed !== panels.size) notFound();
    }
    if (packages.size) {
      const allowed = await prisma.commercialPackage.count({
        where: { id: { in: [...packages] }, organizationId: session.user.organizationId,
          items: { some: { test: testWhere }, every: { test: testWhere } } },
      });
      if (allowed !== packages.size) notFound();
    }
    if (components.size) {
      const allowed = await prisma.testComponent.count({
        where: { id: { in: [...components] }, test: testWhere },
      });
      if (allowed !== components.size) notFound();
    }
    if (lists.size) {
      const allowed = await prisma.priceList.count({ where: {
        id: { in: [...lists] }, organizationId: session.user.organizationId,
        OR: [
          { scopeType: "ORGANIZATION", branchId: null },
          { scopeType: "BRANCH", branchId: { in: [...authorBranches] } },
        ],
      } });
      if (allowed !== lists.size) notFound();
    }
  }

  // CSV clinical source context must not be disclosed to catalog-only users.
  // Authorize BEFORE any staged source/normalized/validation content is loaded.
  if (batch.sourceType === "CSV_REVIEW") {
    // Untrusted workbook/CSV rows contain author-provided commercial and clinical data.
    // Always bind preview to its author and check finance grants before disclosure.
    if (batch.createdByUserId !== session.user.id) notFound();
    const [stagedRanges, stagedComponents, stagedOtherPrices] = await Promise.all([
      prisma.catalogImportRow.count({
        where: { batchId: batch.id, entityType: "REFERENCE_INTERVAL" },
      }),
      prisma.catalogImportRow.count({
        where: { batchId: batch.id, entityType: "COMPONENT" },
      }),
      prisma.catalogImportRow.count({
        where: { batchId: batch.id, entityType: { in: ["PRICE_LIST", "PRICE_LIST_PACKAGE_ITEM"] } },
      }),
    ]);
    if (stagedOtherPrices > 0 && !permissions.has("pricing.manage")) notFound();
    const stagedPriceLists = await prisma.catalogImportRow.findMany({
      where: { batchId: batch.id, entityType: "PRICE_LIST" },
      select: { normalizedData: true },
    });
    if (stagedPriceLists.length) {
      const activeBranchIds = new Set(session.user.branchScopes.filter(scope =>
        scope.branch.status === "ACTIVE" &&
        scope.branch.organizationId === session.user.organizationId
      ).map(scope => scope.branchId));
      const ids = [...activeBranchIds];
      const live = await prisma.branch.findMany({
        where: { organizationId: session.user.organizationId, status: "ACTIVE",
          id: { in: ids } }, select: { id: true },
      });
      const allowedIds = new Set(live.map(branch => branch.id));
      if (stagedPriceLists.some(row => {
        const value = row.normalizedData;
        if (!value || typeof value !== "object" || Array.isArray(value)) return true;
        const data = value as Record<string, unknown>;
        return data.scopeType === "BRANCH" &&
          (typeof data.branchId !== "string" || !allowedIds.has(data.branchId));
      })) notFound();
    }
    if (stagedRanges > 0 || stagedComponents > 0) {
      // Clinical CSV source lacks a branch-bound reviewer assignment.
      // Both component and range previews are author-bound; reference ranges
      // still additionally require their clinical management permission.
      if (batch.createdByUserId !== session.user.id ||
          (stagedRanges > 0 && !permissions.has("catalog.reference_ranges.manage"))) notFound();
      const scope = resolveClinicalImportScope({
        organizationId: session.user.organizationId,
        activeBranchId: session.activeBranchId, activeBranch: session.activeBranch,
        branchScopes: session.user.branchScopes,
        departmentScopes: session.user.departmentScopes,
      });
      if (!scope) notFound();
    }
  }
  // Check the whole batch before loading monetary values, issues or summaries.
  // Never expose cross-branch or unresolved price candidates to catalog staff.
  const stagedPrices = await prisma.catalogImportRow.findMany({
    where: { batchId: batch.id, entityType: "PRICE_LIST_ITEM" },
    select: { normalizedData: true },
  });
  if (stagedPrices.length > 0) {
    if (!permissions.has("pricing.manage")) notFound();
    const allowedBranches = new Set(session.user.branchScopes
      .filter(scope => scope.branch.status === "ACTIVE").map(scope => scope.branchId));
    const codes = [...new Set(stagedPrices.map(row => stagedPriceListCode(row.normalizedData)).filter(Boolean))];
    const lists = await prisma.priceList.findMany({
      where: { organizationId: session.user.organizationId, code: { in: codes } },
      select: { code: true, branchId: true, scopeType: true },
    });
    if (!authorizedStagedPrices(stagedPrices.map(row => row.normalizedData), lists, allowedBranches)) {
      notFound();
    }
    // Batch detail also contains raw normalized candidates and issue summaries.
    // Protect them before loading any source values for off-scope clinical tests.
    const priceScope = resolveClinicalImportScope({
      organizationId: session.user.organizationId,
      activeBranchId: session.activeBranchId, activeBranch: session.activeBranch,
      branchScopes: session.user.branchScopes,
      departmentScopes: session.user.departmentScopes,
    });
    if (!priceScope) notFound();
    const priceTestCodes = [...new Set(stagedPrices
      .map(row => stagedPriceTestCode(row.normalizedData)).filter(Boolean))];
    if (!priceTestCodes.length || stagedPrices.some(row => !stagedPriceTestCode(row.normalizedData))) notFound();
    const accessiblePriceTests = await prisma.labTest.findMany({
      where: { ...clinicalImportTestWhere(priceScope), code: { in: priceTestCodes } },
      select: { code: true },
    });
    const permittedPriceCodes = new Set(accessiblePriceTests.map(test => test.code.trim().toUpperCase()));
    if (priceTestCodes.some(code => !permittedPriceCodes.has(code))) notFound();
  }

  const [groups, issueRows, rows, totalRows] = await Promise.all([
    prisma.catalogImportRow.groupBy({
      by: ["status", "entityType"],
      where: { batchId: batch.id },
      _count: { _all: true },
    }),
    prisma.catalogImportRow.findMany({
      where: { batchId: batch.id, status: { in: ["WARNING", "ERROR"] } },
      select: { entityType: true, status: true, validationIssues: true },
    }),
    prisma.catalogImportRow.findMany({
      where: { batchId: batch.id, ...(status ? { status } : {}) },
      orderBy: { rowNumber: "asc" },
      take: 1000,
    }),
    prisma.catalogImportRow.count({ where: { batchId: batch.id } }),
  ]);

  const counts = groups.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + row._count._all;
    return acc;
  }, {} as Record<string, number>);

  const entityCounts = groups.reduce((acc, row) => {
    acc[row.entityType] = (acc[row.entityType] || 0) + row._count._all;
    return acc;
  }, {} as Record<string, number>);

  const generatedTestRemaining = issueRows.filter((row) => row.entityType === "TEST" && row.status === "WARNING" && (() => {
    const codes = issueCodes(row.validationIssues);
    return codes.length === 1 && codes[0] === "GENERATED_TEST_CODE";
  })()).length;
  const safeMasterRemaining = groups.filter((row) => row.status === "VALID" && row.entityType !== "REFERENCE_INTERVAL").reduce((sum, row) => sum + row._count._all, 0) + generatedTestRemaining;

  const rowStatusLabel = (value: string) => ({
    VALID: tr(locale, "Valid", "صالح"),
    WARNING: tr(locale, "Warning", "تحذير"),
    ERROR: tr(locale, "Error", "خطأ"),
    IMPORTED: tr(locale, "Imported", "مستورد"),
    SKIPPED: tr(locale, "Skipped", "متجاوز"),
    DRAFT: tr(locale, "Draft", "مسودة"),
    VALIDATED: tr(locale, "Validated", "تم التحقق"),
    COMPLETED: tr(locale, "Completed", "مكتمل"),
  }[value] || value);
  const entityLabel = (value: string) => ({
    TEST: tr(locale, "Test", "فحص"),
    UNIT: tr(locale, "Unit", "وحدة"),
    CONTAINER: tr(locale, "Container", "حاوية"),
    PANEL: tr(locale, "Panel", "باقة فحوصات"),
    REFERENCE_INTERVAL: tr(locale, "Reference interval" + (batch.sourceType === "CSV_REVIEW" ? " (review only)" : ""), "مدى مرجعي" + (batch.sourceType === "CSV_REVIEW" ? " (للمراجعة فقط)" : "")),
    COMPONENT: tr(locale, "Result component (review only)", "مكوّن نتائج (للمراجعة فقط)"),
    PRICE_LIST: tr(locale, "Price list (review only)", "قائمة أسعار (للمراجعة فقط)"),
    PRICE_LIST_ITEM: tr(locale, "Price (review only)", "سعر (للمراجعة فقط)"),
  }[value] || value);

  const issueSummary = issueRows.flatMap((row) => issueCodes(row.validationIssues)).reduce((acc, code) => {
    acc[code] = (acc[code] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Legacy Migration Review", "مراجعة ترحيل النظام القديم")}</p>
        <h1>{batch.sourceName}</h1>
        <p className="muted">{tr(locale, "Batch recorded (UTC)", "وقت تسجيل الدفعة (UTC)")}: <SystemDateText value={batch.createdAt.toISOString()} timeZone="UTC" /></p>
        <p className="muted">{tr(locale, "Source rows are preserved separately from normalized candidates. Resolve errors before live import.", "يتم حفظ صفوف المصدر منفصلة عن البيانات المرشحة بعد التطبيع. يجب معالجة الأخطاء قبل الاستيراد إلى البيانات الحية.")}</p>
      </div>
      <Link className="secondary-link" href="/catalog">{tr(locale, "Back to Test Catalog", "العودة إلى دليل الفحوصات")}</Link>
    </header>

    {isBundleReview && <p className="muted">{bundleAttested
      ? tr(locale,
          "Server signature verified: the source contents match a signed configuration export. This does NOT approve, restore or activate clinical or financial settings.",
          "تم التحقق من توقيع الخادم: المحتوى مطابق لتصدير إعدادات موقّع. هذا لا يعتمد ولا يستعيد ولا يفعّل أي إعداد طبي أو مالي.")
      : tr(locale,
          "Unverified source: signature missing or created before signing was supported. Review only; an atomic snapshot claim is not trusted without verified evidence. No settings are applied.",
          "مصدر غير موثّق: التوقيع مفقود أو الملف سابق لدعم التوقيع. للمراجعة فقط؛ لا يُعتمد ادعاء التصدير المتّسق دون دليل موثّق، ولا تُطبّق أي إعدادات.")
    }</p>}

    {isBundleReview && <CatalogGovernanceReadiness batchId={batch.id} locale={locale} />}
    {isBundleReview && <CatalogBundleDriftReview batchId={batch.id} locale={locale} />}

    <section className="catalog-stats">
      <article><strong>{totalRows}</strong><span>{tr(locale, "Total staged", "إجمالي الصفوف المرحلية")}</span></article>
      <article><strong>{counts.VALID || 0}</strong><span>{tr(locale, "Valid", "صالحة")}</span></article>
      <article><strong>{counts.WARNING || 0}</strong><span>{tr(locale, "Warnings", "تحذيرات")}</span></article>
      <article><strong>{counts.ERROR || 0}</strong><span>{tr(locale, "Errors", "أخطاء")}</span></article>
    </section>

    <section className="validation-summary">
      <article className="detail-card">
        <h2>{tr(locale, "Entity Breakdown", "توزيع الكيانات")}</h2>
        <div className="summary-list">
          {Object.entries(entityCounts).sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) =>
            <div key={key}><span>{entityLabel(key)}</span><strong>{value}</strong></div>
          )}
        </div>
      </article>
      <article className="detail-card">
        <h2>{tr(locale, "Issue Breakdown", "توزيع المشكلات")}</h2>
        <div className="summary-list">
          {Object.keys(issueSummary).length === 0
            ? <p className="muted">{tr(locale, "No validation issues.", "لا توجد مشكلات تحقق.")}</p>
            : Object.entries(issueSummary).sort((a,b) => b[1]-a[1]).map(([key,value]) =>
              <div key={key}><span>{key}</span><strong>{value}</strong></div>
            )}
        </div>
      </article>
    </section>

    {batch.sourceType !== "CSV_REVIEW" && !isBundleReview && <section className="detail-card range-import-card">
      <h2>{tr(locale, "Reference Range Migration", "ترحيل المديات المرجعية")}</h2>
      <p className="muted">{tr(locale, "Only exact test matches with mapped units and unambiguous age/sex context are eligible for automatic import. Ambiguous rows remain staged for review.", "لا يُسمح بالاستيراد التلقائي إلا للتطابقات الدقيقة للفحوصات مع وحدات مربوطة وسياق عمر/جنس غير ملتبس. تبقى الصفوف الملتبسة مرحلية للمراجعة.")}</p>
      <ReferenceRangeImportButton batchId={batch.id} locale={locale} />
    </section>}

    {!isBundleReview && entityCounts.COMPONENT > 0 && permissions.has("catalog.manage") && <ComponentImportReconciliation batchId={batch.id} locale={locale} />}
    {!isBundleReview && entityCounts.PRICE_LIST_ITEM > 0 && permissions.has("catalog.manage") && permissions.has("pricing.manage") && <PriceImportReconciliation batchId={batch.id} locale={locale} />}
    {batch.sourceType === "CSV_REVIEW" && entityCounts.REFERENCE_INTERVAL > 0 &&
      permissions.has("catalog.reference_ranges.manage") && <ReferenceRangeImportReconciliation batchId={batch.id} locale={locale} />}

    <section className="table-card">
      <div className="table-toolbar">
        <div>
          <h2>{isBundleReview ? tr(locale, "Configuration bundle review only", "مراجعة ملف الإعدادات فقط") : tr(locale, "Validation Review", "مراجعة التحقق")}</h2>
          <span>{tr(locale, "Status", "الحالة")}: {rowStatusLabel(batch.status)} · {tr(locale, "showing", "عرض")} {rows.length}{status ? ` ${rowStatusLabel(status)}` : ""} {tr(locale, "row(s)", "صف")}</span>
        </div>
        <div className="review-actions">
          <Link className={!status ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}`}>{tr(locale, "All", "الكل")}</Link>
          <Link className={status === "ERROR" ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}?status=ERROR`}>{tr(locale, "Errors", "أخطاء")} ({counts.ERROR || 0})</Link>
          <Link className={status === "WARNING" ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}?status=WARNING`}>{tr(locale, "Warnings", "تحذيرات")} ({counts.WARNING || 0})</Link>
          <Link className={status === "VALID" ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}?status=VALID`}>{tr(locale, "Valid", "صالح")} ({counts.VALID || 0})</Link>
          {batch.status === "DRAFT" && batch.sourceType !== "CSV_REVIEW" && !isBundleReview && <RevalidateImportButton batchId={batch.id} locale={locale} />}
          {batch.status === "VALIDATED" && batch.sourceType !== "CSV_REVIEW" && !isBundleReview && safeMasterRemaining > 0 && <SafeImportButton batchId={batch.id} locale={locale} />}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>{tr(locale, "Entity", "الكيان")}</th><th>{tr(locale, "Legacy key", "المفتاح القديم")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Normalized candidate", "البيانات المطَبّعة المرشحة")}</th><th>{tr(locale, "Issues", "المشكلات")}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}>
            <td>{r.rowNumber}</td><td>{entityLabel(r.entityType)}</td><td>{r.legacyKey || "—"}</td><td><strong>{rowStatusLabel(r.status)}</strong></td>
            <td><code className="json-preview">{JSON.stringify(r.normalizedData)}</code></td>
            <td><code className="json-preview">{Array.isArray(r.validationIssues) && r.validationIssues.length ? JSON.stringify(r.validationIssues) : "—"}</code></td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </main>;
}
