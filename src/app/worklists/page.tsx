import Link from "next/link";
import type { Prisma } from "../../../generated/prisma/client";
import { authorizedDepartmentIds, permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BulkResultEntry } from "@/components/bulk-result-entry";
import { SystemIcon } from "@/components/system-icon";
import { getUiLocale, statusLabel, tr } from "@/lib/ui-i18n";
import { scopedWorklistBranchIds } from "@/lib/clinical-safety";
import { tatRemainingMinutes, tatWorkState } from "@/lib/tat";
import { analyzerCanRouteWorkItem } from "@/lib/analyzer-routing";
import { AnalyzerRoutingControl } from "@/components/analyzer-routing-control";

export const dynamic = "force-dynamic";

export default async function WorklistsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    department?: string;
    branch?: string;
    priority?: string;
    specimenStatus?: string;
    due?: string;
    analyzer?: string;
  }>;
}) {
  const session = await requirePermission("worklists.view");
  const locale = getUiLocale(session.user.preferredLocale);
  const permissions = permissionSet(session);
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const status = params.status?.trim() || "";
  const departmentId = params.department?.trim() || "";
  const branchId = params.branch?.trim() || "";
  const priority = params.priority?.trim() || "";
  const specimenStatus = params.specimenStatus?.trim() || "";
  const due = params.due?.trim() || "";
  const analyzer = params.analyzer?.trim() || "";
  const authorizedBranches = session.user.branchScopes
    .filter(scope => scope.branch.status === "ACTIVE")
    .map(scope => scope.branch);
  const branchIds = authorizedBranches.map(branch => branch.id);
  const worklistBranchIds = scopedWorklistBranchIds(branchIds, branchId || null);
  const priorityFilter = ["ROUTINE", "URGENT", "STAT"].includes(priority)
    ? priority as "ROUTINE" | "URGENT" | "STAT"
    : null;
  const specimenStatusFilter = ["RECEIVED", "IN_PROCESS"].includes(specimenStatus)
    ? specimenStatus as "RECEIVED" | "IN_PROCESS"
    : null;
  const dueFilter = ["OVERDUE", "PENDING", "NO_TAT"].includes(due)
    ? due as "OVERDUE" | "PENDING" | "NO_TAT"
    : null;
  const scopedDepartmentIds = authorizedDepartmentIds(session);
  const departmentRestricted = scopedDepartmentIds.length > 0;
  const departmentFilter = departmentId
    ? (departmentRestricted && !scopedDepartmentIds.includes(departmentId)
      ? { departmentId: "__FORBIDDEN__" }
      : { departmentId })
    : (departmentRestricted ? { departmentId: { in: scopedDepartmentIds } } : {});
  const now = new Date();
  const andFilters: Prisma.OrderItemWhereInput[] = [];

  if (q) {
    andFilters.push({
      OR: [
        { testCodeSnapshot: { contains: q } },
        { testNameEnSnapshot: { contains: q } },
        { order: { accessionNumber: { contains: q } } },
        { order: { patient: { patientNumber: { contains: q } } } },
        { order: { patient: { fullNameEn: { contains: q } } } },
        { specimenLinks: { some: { status: "ACTIVE", specimen: { barcode: { contains: q } } } } },
      ],
    });
  }

  if (dueFilter === "OVERDUE") {
    andFilters.push({
      status: { notIn: ["VERIFIED", "CANCELLED"] },
      tatDueAt: { lt: now },
    });
  } else if (dueFilter === "PENDING") {
    andFilters.push({
      status: { notIn: ["VERIFIED", "CANCELLED"] },
      tatDueAt: { gte: now },
    });
  } else if (dueFilter === "NO_TAT") {
    andFilters.push({ tatDueAt: null });
  }

  if (analyzer === "UNASSIGNED") {
    andFilters.push({ analyzerRoutes: { none: {} } });
  } else if (analyzer) {
    andFilters.push({ analyzerRoutes: { some: { analyzerId: analyzer } } });
  }

  const [items, departments, analyzers] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        order: {
          organizationId: session.user.organizationId,
          ...(priorityFilter ? { priority: priorityFilter } : {}),
        },
        status: { not: "CANCELLED" },
        specimenLinks: {
          some: {
            status: "ACTIVE",
            specimen: {
              currentBranchId: { in: worklistBranchIds },
              status: specimenStatusFilter || { in: ["RECEIVED","IN_PROCESS"] },
            },
          },
        },
        ...(status && ["ORDERED","COLLECTED","IN_PROGRESS","RESULTED","VERIFIED"].includes(status)
          ? { status: status as "ORDERED" | "COLLECTED" | "IN_PROGRESS" | "RESULTED" | "VERIFIED" }
          : {}),
        ...(Object.keys(departmentFilter).length ? { test: departmentFilter } : {}),
        ...(andFilters.length ? { AND: andFilters } : {}),
      },
      include: {
        order: { include: { patient: true, orderingBranch: true } },
        test: {
          include: {
            department: true,
            defaultUnit: true,
            components: {
              where: { status: "ACTIVE" },
              include: {
                unit: true,
                qualitativeResultOptions: {
                  where: {
                    status: "ACTIVE",
                    effectiveFrom: { lte: now },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
                  },
                  orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
                },
              },
              orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
            },
            qualitativeResultOptions: {
              where: {
                componentId: null,
                status: "ACTIVE",
                effectiveFrom: { lte: now },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
              },
              orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
            },
          },
        },
        performedBranch: true,
        specimenLinks: {
          where: { status: "ACTIVE" },
          include: { specimen: { include: { currentBranch: true } } },
          orderBy: { createdAt: "desc" },
        },
        analyzerRoutes: {
          orderBy: { assignedAt: "asc" },
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
      where: { organizationId: session.user.organizationId, status: "ACTIVE", ...(departmentRestricted ? { id: { in: scopedDepartmentIds } } : {}) },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.analyzer.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: worklistBranchIds },
        status: "ACTIVE",
        ...(departmentRestricted ? {
          OR: [{ departmentId: null }, { departmentId: { in: scopedDepartmentIds } }],
        } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        branchId: true,
        departmentId: true,
        mappings: {
          where: {
            status: "ACTIVE",
            effectiveFrom: { lte: now },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
          },
          select: { testId: true },
        },
      },
      orderBy: [{ code: "asc" }],
    }),
  ]);

  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const patientName = (item: { fullNameEn: string; fullNameAr?: string | null }) => locale === "ar" ? item.fullNameAr || item.fullNameEn : item.fullNameEn;
  const priorityLabel = (value: "ROUTINE" | "URGENT" | "STAT") => ({
    ROUTINE: tr(locale, "Routine", "عادي"),
    URGENT: tr(locale, "Urgent", "عاجل"),
    STAT: "STAT",
  }[value]);
  const formatTatMinutes = (minutes: number) => {
    const absolute = Math.abs(minutes);
    if (absolute >= 1440) {
      const days = Math.floor(absolute / 1440);
      const hours = Math.floor((absolute % 1440) / 60);
      return hours ? `${days}d ${hours}h` : `${days}d`;
    }
    if (absolute >= 60) {
      const hours = Math.floor(absolute / 60);
      const mins = absolute % 60;
      return mins ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${absolute}m`;
  };
  const formatTatDueAt = (value: Date, timezone: string) => new Intl.DateTimeFormat(
    locale === "ar" ? "ar-AE" : "en-GB",
    { timeZone: timezone, year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" },
  ).format(value);

  const pendingEntry = items.filter(item => !item.results[0]).length;
  const inProgress = items.filter(item => item.results[0] && !["VERIFIED","RELEASED","AMENDED"].includes(item.results[0].status)).length;
  const verified = items.filter(item => item.results[0]?.status === "VERIFIED").length;
  const critical = items.filter(item => item.results[0]?.values.some(value => value.isCritical)).length;

  const bulkRows = items.flatMap(item => {
    const readySpecimen = item.specimenLinks.map(link => link.specimen).find(specimen =>
      ["RECEIVED","IN_PROCESS"].includes(specimen.status) &&
      (!specimenStatusFilter || specimen.status === specimenStatusFilter) &&
      Boolean(specimen.currentBranchId) &&
      worklistBranchIds.includes(specimen.currentBranchId!)
    );
    const latest = item.results[0];
    if (!readySpecimen?.currentBranchId) return [];
    if (latest && (
      latest.source !== "MANUAL"
      || ["VERIFIED","RELEASED","AMENDED","CANCELLED"].includes(latest.status)
      || ["MEDICAL_VALIDATION","COMPLETE"].includes(latest.validationStage)
    )) return [];

    const currentByComponent = new Map((latest?.values || []).map(value => [value.componentId || "__TEST__", value]));
    const fields = item.test.components.length > 0
      ? item.test.components.map(component => ({
          componentId: component.id,
          code: component.code,
          nameEn: component.nameEn,
          nameAr: component.nameAr,
          resultType: component.resultType,
          currentValue: currentByComponent.get(component.id)?.displayValue || "",
          currentOptionId: currentByComponent.get(component.id)?.qualitativeOptionId || null,
          qualitativeOptions: component.qualitativeResultOptions.map(option => ({
            id: option.id,
            code: option.code,
            valueEn: option.valueEn,
            valueAr: option.valueAr,
            flag: option.flag,
            isAbnormal: option.isAbnormal,
            isCritical: option.isCritical,
          })),
        }))
      : [{
          componentId: null,
          code: item.test.code,
          nameEn: item.test.nameEn,
          nameAr: item.test.nameAr,
          resultType: item.test.resultType,
          currentValue: currentByComponent.get("__TEST__")?.displayValue || "",
          currentOptionId: currentByComponent.get("__TEST__")?.qualitativeOptionId || null,
          qualitativeOptions: item.test.qualitativeResultOptions.map(option => ({
            id: option.id,
            code: option.code,
            valueEn: option.valueEn,
            valueAr: option.valueAr,
            flag: option.flag,
            isAbnormal: option.isAbnormal,
            isCritical: option.isCritical,
          })),
        }];

    return [{
      orderItemId: item.id,
      accessionNumber: item.order.accessionNumber,
      patientNumber: item.order.patient.patientNumber,
      patientName: patientName(item.order.patient),
      testCode: item.testCodeSnapshot,
      testName: locale === "ar" ? item.testNameArSnapshot || item.testNameEnSnapshot : item.testNameEnSnapshot,
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

    {permissions.has("results.enter") && <BulkResultEntry rows={bulkRows} locale={locale} />}

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>{tr(locale, "Laboratory Work Queue", "قائمة عمل المختبر")}</h2><span>{items.length} {tr(locale, "item(s)", "عنصر")}</span></div>
        <form className="inline-search" action="/worklists" method="get">
          <input name="q" defaultValue={q} placeholder={tr(locale, "Barcode, accession, patient, test…", "باركود، رقم طلب، مريض، فحص…")} />
          <select name="branch" defaultValue={branchId}>
            <option value="">{tr(locale, "All authorized branches", "كل الفروع المصرح بها")}</option>
            {authorizedBranches
              .slice()
              .sort((a, b) => localizedName(a).localeCompare(localizedName(b)))
              .map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}
          </select>
          <select name="priority" defaultValue={priority}>
            <option value="">{tr(locale, "All priorities", "كل الأولويات")}</option>
            <option value="ROUTINE">{priorityLabel("ROUTINE")}</option>
            <option value="URGENT">{priorityLabel("URGENT")}</option>
            <option value="STAT">{priorityLabel("STAT")}</option>
          </select>
          <select name="specimenStatus" defaultValue={specimenStatus}>
            <option value="">{tr(locale, "All ready specimen states", "كل حالات العينات الجاهزة")}</option>
            <option value="RECEIVED">{statusLabel(locale, "RECEIVED")}</option>
            <option value="IN_PROCESS">{statusLabel(locale, "IN_PROCESS")}</option>
          </select>
          <select name="department" defaultValue={departmentId}>
            <option value="">{tr(locale, "All departments", "كل الأقسام")}</option>
            {departments.map(department => <option key={department.id} value={department.id}>{department.code} — {localizedName(department)}</option>)}
          </select>
          <select name="analyzer" defaultValue={analyzer}>
            <option value="">{tr(locale, "All analyzers", "كل أجهزة التحليل")}</option>
            <option value="UNASSIGNED">{tr(locale, "Unassigned analyzer", "بدون جهاز معيّن")}</option>
            {analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
          </select>
          <select name="due" defaultValue={due}>
            <option value="">{tr(locale, "All TAT states", "كل حالات زمن الإنجاز")}</option>
            <option value="OVERDUE">{tr(locale, "Overdue", "متأخر")}</option>
            <option value="PENDING">{tr(locale, "Pending within TAT", "ضمن زمن الإنجاز")}</option>
            <option value="NO_TAT">{tr(locale, "No TAT snapshot", "بدون لقطة زمن إنجاز")}</option>
          </select>
          <select name="status" defaultValue={status}>
            <option value="">{tr(locale, "All statuses", "كل الحالات")}</option>
            <option value="COLLECTED">{statusLabel(locale, "COLLECTED")}</option>
            <option value="IN_PROGRESS">{statusLabel(locale, "IN_PROGRESS")}</option>
            <option value="RESULTED">{statusLabel(locale, "RESULTED")}</option>
            <option value="VERIFIED">{statusLabel(locale, "VERIFIED")}</option>
          </select>
          <button className="secondary-button"><SystemIcon name="search" size={15} />{tr(locale, "Filter", "تصفية")}</button>
          {(q || status || departmentId || branchId || priority || specimenStatus || due || analyzer) && <Link className="secondary-link" href="/worklists">{tr(locale, "Clear", "مسح")}</Link>}
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Accession", "رقم الطلب")}</th><th>{tr(locale, "Patient", "المريض")}</th><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Priority", "الأولوية")}</th><th>{tr(locale, "Department", "القسم")}</th><th>{tr(locale, "Specimen", "العينة")}</th><th>{tr(locale, "Location", "الموقع")}</th><th>{tr(locale, "Analyzer", "جهاز التحليل")}</th><th>{tr(locale, "TAT / Due", "زمن الإنجاز / الاستحقاق")}</th><th>{tr(locale, "Result", "النتيجة")}</th><th>{tr(locale, "Validation", "التحقق")}</th><th>{tr(locale, "Flags", "الإشارات")}</th><th></th></tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={13} className="empty-state">{tr(locale, "No received specimens are waiting for laboratory work.", "لا توجد عينات مستلمة بانتظار العمل المخبري.")}</td></tr> :
              items.map(item => {
                const readySpecimen = item.specimenLinks.map(link => link.specimen).find(specimen =>
                  ["RECEIVED","IN_PROCESS"].includes(specimen.status) &&
                  (!specimenStatusFilter || specimen.status === specimenStatusFilter) &&
                  Boolean(specimen.currentBranchId) &&
                  worklistBranchIds.includes(specimen.currentBranchId!)
                );
                const result = item.results[0];
                const criticalCount = result?.values.filter(value => value.isCritical).length || 0;
                const abnormalCount = result?.values.filter(value => value.isAbnormal).length || 0;
                const tatState = tatWorkState(item.tatDueAt, item.status, now);
                const tatRemaining = tatRemainingMinutes(item.tatDueAt, now);
                const readySpecimenBranchIds = readySpecimen?.currentBranchId ? [readySpecimen.currentBranchId] : [];
                const analyzerCandidates = analyzers
                  .filter(candidate => analyzerCanRouteWorkItem({
                    analyzerId: candidate.id,
                    analyzerBranchId: candidate.branchId,
                    analyzerDepartmentId: candidate.departmentId,
                    mappedTestIds: [...new Set(candidate.mappings.map(mapping => mapping.testId))],
                  }, {
                    testId: item.testId,
                    testDepartmentId: item.test.departmentId,
                    readySpecimenBranchIds,
                  }))
                  .map(candidate => ({ id: candidate.id, code: candidate.code, name: candidate.name }));
                const routeLocked = Boolean(result && (
                  ["VERIFIED","RELEASED","AMENDED","CANCELLED"].includes(result.status)
                  || result.validationStage === "COMPLETE"
                ));
                return <tr key={item.id}>
                  <td><strong>{item.order.accessionNumber}</strong></td>
                  <td>{item.order.patient.patientNumber}<br/><small>{patientName(item.order.patient)}</small></td>
                  <td><strong>{item.testCodeSnapshot}</strong><br/><small>{locale === "ar" ? item.testNameArSnapshot || item.testNameEnSnapshot : item.testNameEnSnapshot}</small></td>
                  <td><strong>{priorityLabel(item.order.priority)}</strong></td>
                  <td>{item.test.department ? localizedName(item.test.department) : tr(locale, "Unassigned", "غير معيّن")}</td>
                  <td><span className="barcode-text">{readySpecimen?.barcode || "—"}</span><br/><small>{readySpecimen?.status ? statusLabel(locale, readySpecimen.status) : "—"}</small></td>
                  <td>{readySpecimen?.currentBranch ? localizedName(readySpecimen.currentBranch) : item.performedBranch ? localizedName(item.performedBranch) : "—"}</td>
                  <td><AnalyzerRoutingControl
                    orderItemId={item.id}
                    assigned={item.analyzerRoutes.map(route => ({
                      analyzerId: route.analyzerId,
                      analyzerCodeSnapshot: route.analyzerCodeSnapshot,
                      analyzerNameSnapshot: route.analyzerNameSnapshot,
                    }))}
                    candidates={analyzerCandidates}
                    canRoute={permissions.has("worklists.route") && !routeLocked}
                    locale={locale}
                  /></td>
                  <td>
                    {item.tatDueAt ? <>
                      <strong className={tatState === "OVERDUE" ? "critical-text" : ""}>
                        {tatState === "OVERDUE" && tatRemaining !== null
                          ? tr(locale, `Overdue ${formatTatMinutes(tatRemaining)}`, `متأخر ${formatTatMinutes(tatRemaining)}`)
                          : tatState === "PENDING" && tatRemaining !== null
                            ? tr(locale, `${formatTatMinutes(tatRemaining)} remaining`, `متبقٍ ${formatTatMinutes(tatRemaining)}`)
                            : tr(locale, "Completed", "مكتمل")}
                      </strong>
                      <br/><small>{formatTatDueAt(item.tatDueAt, item.order.orderingBranch.timezone)} · {item.tatMinutesSnapshot ?? "—"} {tr(locale, "min", "دقيقة")}</small>
                    </> : <span className="muted">
                      {item.tatSnapshotSource === "MIGRATED_BASELINE"
                        ? tr(locale, "Historical item — no TAT snapshot", "عنصر تاريخي — لا توجد لقطة زمن إنجاز")
                        : tr(locale, "TAT not configured", "زمن الإنجاز غير مهيأ")}
                    </span>}
                  </td>
                  <td><span className={"status-badge status-" + (result?.status || item.status).toLowerCase().replaceAll("_","-")}>{statusLabel(locale, result?.status || item.status)}</span></td>
                  <td>{result ? (
                    result.validationStage === "MEDICAL_VALIDATION" ? tr(locale, "Medical validation", "تحقق طبي") :
                    result.validationStage === "COMPLETE" ? tr(locale, "Complete", "مكتمل") :
                    result.validationStage === "TECHNICAL_REVIEW" ? tr(locale, "Technical review", "مراجعة فنية") :
                    tr(locale, "Entry", "إدخال")
                  ) : "—"}</td>
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
