import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SafeImportButton } from "@/components/safe-import-button";
import { RevalidateImportButton } from "@/components/revalidate-import-button";
import { ReferenceRangeImportButton } from "@/components/reference-range-import-button";
import { getUiLocale, tr } from "@/lib/ui-i18n";

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
  const session = await requirePermission("catalog.view");
  const locale = getUiLocale(session.user.preferredLocale);
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
    REFERENCE_INTERVAL: tr(locale, "Reference interval", "مدى مرجعي"),
    COMPONENT: tr(locale, "Result component (review only)", "مكوّن نتائج (للمراجعة فقط)"),
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
        <p className="muted">{tr(locale, "Source rows are preserved separately from normalized candidates. Resolve errors before live import.", "يتم حفظ صفوف المصدر منفصلة عن البيانات المرشحة بعد التطبيع. يجب معالجة الأخطاء قبل الاستيراد إلى البيانات الحية.")}</p>
      </div>
      <Link className="secondary-link" href="/catalog">{tr(locale, "Back to Test Catalog", "العودة إلى دليل الفحوصات")}</Link>
    </header>

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

    <section className="detail-card range-import-card">
      <h2>{tr(locale, "Reference Range Migration", "ترحيل المديات المرجعية")}</h2>
      <p className="muted">{tr(locale, "Only exact test matches with mapped units and unambiguous age/sex context are eligible for automatic import. Ambiguous rows remain staged for review.", "لا يُسمح بالاستيراد التلقائي إلا للتطابقات الدقيقة للفحوصات مع وحدات مربوطة وسياق عمر/جنس غير ملتبس. تبقى الصفوف الملتبسة مرحلية للمراجعة.")}</p>
      <ReferenceRangeImportButton batchId={batch.id} locale={locale} />
    </section>

    <section className="table-card">
      <div className="table-toolbar">
        <div>
          <h2>{tr(locale, "Validation Review", "مراجعة التحقق")}</h2>
          <span>{tr(locale, "Status", "الحالة")}: {rowStatusLabel(batch.status)} · {tr(locale, "showing", "عرض")} {rows.length}{status ? ` ${rowStatusLabel(status)}` : ""} {tr(locale, "row(s)", "صف")}</span>
        </div>
        <div className="review-actions">
          <Link className={!status ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}`}>{tr(locale, "All", "الكل")}</Link>
          <Link className={status === "ERROR" ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}?status=ERROR`}>{tr(locale, "Errors", "أخطاء")} ({counts.ERROR || 0})</Link>
          <Link className={status === "WARNING" ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}?status=WARNING`}>{tr(locale, "Warnings", "تحذيرات")} ({counts.WARNING || 0})</Link>
          <Link className={status === "VALID" ? "filter-chip active" : "filter-chip"} href={`/catalog/imports/${batch.id}?status=VALID`}>{tr(locale, "Valid", "صالح")} ({counts.VALID || 0})</Link>
          {batch.status === "DRAFT" && <RevalidateImportButton batchId={batch.id} locale={locale} />}
          {batch.status === "VALIDATED" && safeMasterRemaining > 0 && <SafeImportButton batchId={batch.id} locale={locale} />}
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
