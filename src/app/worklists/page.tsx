import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BulkResultEntry } from "@/components/bulk-result-entry";
import { SystemIcon } from "@/components/system-icon";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function WorklistsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; department?: string }>;
}) {
  const session = await requirePermission("worklists.view");
  const locale = getUiLocale(session.user.preferredLocale);
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const status = params.status?.trim() || "";
  const departmentId = params.department?.trim() || "";
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [items, departments] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        order: { organizationId: session.user.organizationId },
        status: { not: "CANCELLED" },
        specimenLinks: {
          some: {
            specimen: {
              currentBranchId: { in: branchIds },
              status: { in: ["RECEIVED","IN_PROCESS"] },
            },
          },
        },
        ...(status && ["ORDERED","COLLECTED","IN_PROGRESS","RESULTED","VERIFIED"].includes(status)
          ? { status: status as "ORDERED" | "COLLECTED" | "IN_PROGRESS" | "RESULTED" | "VERIFIED" }
          : {}),
        ...(departmentId ? { test: { departmentId } } : {}),
        ...(q ? {
          AND: [{
            OR: [
              { testCodeSnapshot: { contains: q } },
              { testNameEnSnapshot: { contains: q } },
              { order: { accessionNumber: { contains: q } } },
              { order: { patient: { patientNumber: { contains: q } } } },
              { order: { patient: { fullNameEn: { contains: q } } } },
              { specimenLinks: { some: { specimen: { barcode: { contains: q } } } } },
            ],
          }],
        } : {}),
      },
      include: {
        order: { include: { patient: true, orderingBranch: true } },
        test: {
          include: {
            department: true,
            defaultUnit: true,
            components: {
              where: { status: "ACTIVE" },
              include: { unit: true },
              orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
            },
          },
        },
        performedBranch: true,
        specimenLinks: {
          include: { specimen: { include: { currentBranch: true } } },
          orderBy: { createdAt: "desc" },
        },
        results: {
          orderBy: { version: "desc" },
          take: 1,
          include: { values: true },
        },
      },
      orderBy: { createdAt: "asc" },
      take: 300,
    }),
    prisma.department.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
  ]);

  const pendingEntry = items.filter(item => !item.results[0]).length;
  const inProgress = items.filter(item => item.results[0] && !["VERIFIED","RELEASED","AMENDED"].includes(item.results[0].status)).length;
  const verified = items.filter(item => item.results[0]?.status === "VERIFIED").length;
  const critical = items.filter(item => item.results[0]?.values.some(value => value.isCritical)).length;

  const bulkRows = items.flatMap(item => {
    const readySpecimen = item.specimenLinks.map(link => link.specimen).find(specimen =>
      ["RECEIVED","IN_PROCESS"].includes(specimen.status) &&
      Boolean(specimen.currentBranchId) &&
      branchIds.includes(specimen.currentBranchId!)
    );
    const latest = item.results[0];
    if (!readySpecimen?.currentBranchId) return [];
    if (latest && (latest.source !== "MANUAL" || ["VERIFIED","RELEASED","AMENDED","CANCELLED"].includes(latest.status))) return [];

    const currentByComponent = new Map((latest?.values || []).map(value => [value.componentId || "__TEST__", value.displayValue]));
    const fields = item.test.components.length > 0
      ? item.test.components.map(component => ({
          componentId: component.id,
          code: component.code,
          nameEn: component.nameEn,
          resultType: component.resultType,
          currentValue: currentByComponent.get(component.id) || "",
        }))
      : [{
          componentId: null,
          code: item.test.code,
          nameEn: item.test.nameEn,
          resultType: item.test.resultType,
          currentValue: currentByComponent.get("__TEST__") || "",
        }];

    return [{
      orderItemId: item.id,
      accessionNumber: item.order.accessionNumber,
      patientNumber: item.order.patient.patientNumber,
      patientName: item.order.patient.fullNameEn,
      testCode: item.testCodeSnapshot,
      testName: item.testNameEnSnapshot,
      specimenId: readySpecimen.id,
      barcode: readySpecimen.barcode,
      performingBranchId: readySpecimen.currentBranchId,
      fields,
      comments: latest?.comments || "",
    }];
  });

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Laboratory Operations", "عمليات المختبر")}</p>
        <h1 className="page-title-with-icon"><SystemIcon name="worklist" size={25} />{tr(locale, "Worklists", "قوائم العمل")}</h1>
        <p className="muted">{tr(locale, "Received specimens ready for analytical work, result entry and controlled verification.", "العينات المستلمة الجاهزة للعمل التحليلي وإدخال النتائج والتحقق المنضبط.")}</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/specimens"><SystemIcon name="specimen" size={15} />{tr(locale, "Specimens", "العينات")}</Link>
        <Link className="secondary-link" href="/dashboard"><SystemIcon name="dashboard" size={15} />{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
      </div>
    </header>

    <section className="workflow-summary">
      <article><span>{tr(locale, "Awaiting entry", "بانتظار الإدخال")}</span><strong>{pendingEntry}</strong><small>{tr(locale, "received tests without result", "فحوصات مستلمة بدون نتيجة")}</small></article>
      <article><span>{tr(locale, "In progress", "قيد العمل")}</span><strong>{inProgress}</strong><small>{tr(locale, "entered / under review", "مدخلة / قيد المراجعة")}</small></article>
      <article><span>{tr(locale, "Verified", "تم التحقق")}</span><strong>{verified}</strong><small>{tr(locale, "ready for release workflow", "جاهزة لمسار الإصدار")}</small></article>
      <article className={critical ? "summary-attention" : ""}><span>{tr(locale, "Critical", "حرجة")}</span><strong>{critical}</strong><small>{tr(locale, "items containing critical values", "عناصر تحتوي قيماً حرجة")}</small></article>
    </section>

    <BulkResultEntry rows={bulkRows} />

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>{tr(locale, "Laboratory Work Queue", "قائمة عمل المختبر")}</h2><span>{items.length} item(s)</span></div>
        <form className="inline-search" action="/worklists" method="get">
          <input name="q" defaultValue={q} placeholder={tr(locale, "Barcode, accession, patient, test…", "باركود، رقم طلب، مريض، فحص…")} />
          <select name="department" defaultValue={departmentId}>
            <option value="">{tr(locale, "All departments", "كل الأقسام")}</option>
            {departments.map(department => <option key={department.id} value={department.id}>{department.code} — {department.nameEn}</option>)}
          </select>
          <select name="status" defaultValue={status}>
            <option value="">{tr(locale, "All statuses", "كل الحالات")}</option>
            <option value="COLLECTED">COLLECTED</option>
            <option value="IN_PROGRESS">IN_PROGRESS</option>
            <option value="RESULTED">RESULTED</option>
            <option value="VERIFIED">VERIFIED</option>
          </select>
          <button className="secondary-button"><SystemIcon name="search" size={15} />{tr(locale, "Filter", "تصفية")}</button>
          {(q || status || departmentId) && <Link className="secondary-link" href="/worklists">{tr(locale, "Clear", "مسح")}</Link>}
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Accession", "رقم الطلب")}</th><th>{tr(locale, "Patient", "المريض")}</th><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Department", "القسم")}</th><th>{tr(locale, "Specimen", "العينة")}</th><th>{tr(locale, "Location", "الموقع")}</th><th>{tr(locale, "Result", "النتيجة")}</th><th>{tr(locale, "Flags", "الإشارات")}</th><th></th></tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={9} className="empty-state">{tr(locale, "No received specimens are waiting for laboratory work.", "لا توجد عينات مستلمة بانتظار العمل المخبري.")}</td></tr> :
              items.map(item => {
                const readySpecimen = item.specimenLinks.map(link => link.specimen).find(specimen => ["RECEIVED","IN_PROCESS"].includes(specimen.status));
                const result = item.results[0];
                const criticalCount = result?.values.filter(value => value.isCritical).length || 0;
                const abnormalCount = result?.values.filter(value => ["LOW","HIGH","CRITICAL_LOW","CRITICAL_HIGH","ABNORMAL"].includes(value.flag)).length || 0;
                return <tr key={item.id}>
                  <td><strong>{item.order.accessionNumber}</strong></td>
                  <td>{item.order.patient.patientNumber}<br/><small>{item.order.patient.fullNameEn}</small></td>
                  <td><strong>{item.testCodeSnapshot}</strong><br/><small>{item.testNameEnSnapshot}</small></td>
                  <td>{item.test.department?.nameEn || tr(locale, "Unassigned", "غير معيّن")}</td>
                  <td><span className="barcode-text">{readySpecimen?.barcode || "—"}</span><br/><small>{readySpecimen?.status || "—"}</small></td>
                  <td>{readySpecimen?.currentBranch?.nameEn || item.performedBranch?.nameEn || "—"}</td>
                  <td><span className={"status-badge status-" + (result?.status || item.status).toLowerCase().replaceAll("_","-")}>{statusLabel(locale, result?.status || item.status)}</span></td>
                  <td>{criticalCount > 0 ? <strong className="critical-text">{criticalCount} {tr(locale, "critical", "حرجة")}</strong> : abnormalCount > 0 ? `${abnormalCount} ${tr(locale, "flagged", "معلّمة")}` : "—"}</td>
                  <td><Link className="secondary-link" href={`/worklists/${item.id}`}><SystemIcon name="report" size={15} />{result ? tr(locale, "Open Result", "فتح النتيجة") : tr(locale, "Enter Result", "إدخال النتيجة")}</Link></td>
                </tr>;
              })
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
