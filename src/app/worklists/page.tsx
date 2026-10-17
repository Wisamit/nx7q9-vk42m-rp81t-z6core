import { TableEmptyState } from "@/components/table-empty-state";
import { SystemDateText } from "@/components/system-date-text";
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
import { WORKLIST_PAGE_SIZE, decodeWorklistCursor, worklistAfterWhere, worklistPage, worklistPageHref, type WorklistFilterState } from "@/lib/worklist-pagination";
import { AnalyzerRoutingControl } from "@/components/analyzer-routing-control";
import { TatEscalationAcknowledge } from "@/components/tat-escalation-acknowledge";

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
    after?: string;
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
  const worklistFilters: WorklistFilterState = {
    q, status, department: departmentId, branch: branchId, priority,
    specimenStatus, due, analyzer,
  };
  const cursor = decodeWorklistCursor(params.after, worklistFilters);
  const invalidCursor = Boolean(params.after && !cursor);
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
  const dueFilter = ["OVERDUE", "DUE_SOON", "PENDING", "NO_TAT"].includes(due)
    ? due as "OVERDUE" | "DUE_SOON" | "PENDING" | "NO_TAT"
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
  // Cursors never grant access; all original organization, branch,
  // department, specimen, priority and SLA filters remain authoritative.
  if (cursor) andFilters.push(worklistAfterWhere(cursor));

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
  } else if (dueFilter === "DUE_SOON") {
    andFilters.push({
      status: { notIn: ["VERIFIED", "CANCELLED"] },
      tatDueAt: { gte: now },
      tatAlertAt: { lte: now },
    });
  } else if (dueFilter === "PENDING") {
    andFilters.push({
      status: { notIn: ["VERIFIED", "CANCELLED"] },
      tatDueAt: { gte: now },
      OR: [{ tatAlertAt: null }, { tatAlertAt: { gt: now } }],
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
        tatEscalations: {
          orderBy: { level: "desc" },
          take: 1,
        },
        results: {
          orderBy: { version: "desc" },
          take: 1,
          include: { values: true },
        },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: WORKLIST_PAGE_SIZE + 1,
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

  const worklistWindow = worklistPage(items, worklistFilters);
  const visibleItems = worklistWindow.rows;
  const firstPageHref = worklistPageHref(worklistFilters, null);
  const nextPageHref = worklistWindow.nextCursor
    ? worklistPageHref(worklistFilters, worklistWindow.nextCursor) : null;
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

  const pendingEntry = visibleItems.filter(item => !item.results[0]).length;
  const inProgress = visibleItems.filter(item => item.results[0] && !["VERIFIED","RELEASED","AMENDED"].includes(item.results[0].status)).length;
  const verified = visibleItems.filter(item => item.results[0]?.status === "VERIFIED").length;
  const critical = visibleItems.filter(item => item.results[0]?.values.some(value => value.isCritical)).length;

  const bulkRows = visibleItems.flatMap(item => {
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

  return <main className="catalog-shell filter-workspace">
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

    <p className="muted">{tr(locale,
      "Worklist counters and bulk entry below apply to this 50-item page. Navigate to review the rest of the authorized queue.",
      "العدادات وإدخال النتائج الجماعي أدناه يخصان هذه الصفحة المكونة من 50 فحصًا. انتقل بين الصفحات لمراجعة كامل قائمة العمل المصرّح بها."
    )}</p>
    <section className="workflow-summary">
      <article><span>{tr(locale, "Awaiting entry", "بانتظار الإدخال")}</span><strong>{pendingEntry}</strong><small>{tr(locale, "received tests without result", "فحوصات مستلمة بدون نتيجة")}</small></article>
      <article><span>{tr(locale, "In progress", "قيد العمل")}</span><strong>{inProgress}</strong><small>{tr(locale, "entered / under review", "مدخلة / قيد المراجعة")}</small></article>
      <article><span>{tr(locale, "Verified", "تم التحقق")}</span><strong>{verified}</strong><small>{tr(locale, "ready for release workflow", "جاهزة لمسار الإصدار")}</small></article>
      <article className={critical ? "summary-attention" : ""}><span>{tr(locale, "Critical", "حرجة")}</span><strong>{critical}</strong><small>{tr(locale, "items containing critical values", "عناصر تحتوي قيماً حرجة")}</small></article>
    </section>

    {permissions.has("results.enter") && <BulkResultEntry rows={bulkRows} locale={locale} />}

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>{tr(locale, "Laboratory Work Queue", "قائمة عمل المختبر")}</h2><span>{visibleItems.length} {tr(locale, "item(s) on this page", "عنصر بهذه الصفحة")}{worklistWindow.hasNext ? " · +" : ""}</span></div>
        <form className="inline-search queue-filters" action="/worklists" method="get">
          <input type="search" name="q" aria-label={tr(locale, "Find barcode, accession, patient or test", "بحث باركود أو طلب أو مريض أو فحص")} defaultValue={q} placeholder={tr(locale, "Barcode, accession, patient, test…", "باركود، رقم طلب، مريض، فحص…")} />
          <select name="branch" aria-label={tr(locale, "Performing branch", "فرع التنفيذ")} defaultValue={branchId}>
            <option value="">{tr(locale, "All authorized branches", "كل الفروع المصرح بها")}</option>
            {authorizedBranches
              .slice()
              .sort((a, b) => localizedName(a).localeCompare(localizedName(b)))
              .map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}
          </select>
          <select name="priority" aria-label={tr(locale, "Order priority", "أولوية الطلب")} defaultValue={priority}>
            <option value="">{tr(locale, "All priorities", "كل الأولويات")}</option>
            <option value="ROUTINE">{priorityLabel("ROUTINE")}</option>
            <option value="URGENT">{priorityLabel("URGENT")}</option>
            <option value="STAT">{priorityLabel("STAT")}</option>
          </select>
          <select name="specimenStatus" aria-label={tr(locale, "Specimen state", "حالة العينة")} defaultValue={specimenStatus}>
            <option value="">{tr(locale, "All ready specimen states", "كل حالات العينات الجاهزة")}</option>
            <option value="RECEIVED">{statusLabel(locale, "RECEIVED")}</option>
            <option value="IN_PROCESS">{statusLabel(locale, "IN_PROCESS")}</option>
          </select>
          <select name="department" aria-label={tr(locale, "Department", "القسم")} defaultValue={departmentId}>
            <option value="">{tr(locale, "All departments", "كل الأقسام")}</option>
            {departments.map(department => <option key={department.id} value={department.id}>{department.code} — {localizedName(department)}</option>)}
          </select>
          <select name="analyzer" aria-label={tr(locale, "Analyzer", "جهاز التحليل")} defaultValue={analyzer}>
            <option value="">{tr(locale, "All analyzers", "كل أجهزة التحليل")}</option>
            <option value="UNASSIGNED">{tr(locale, "Unassigned analyzer", "بدون جهاز معيّن")}</option>
            {analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
          </select>
          <select name="due" aria-label={tr(locale, "TAT / due status", "حالة زمن الإنجاز")} defaultValue={due}>
            <option value="">{tr(locale, "All TAT states", "كل حالات زمن الإنجاز")}</option>
            <option value="OVERDUE">{tr(locale, "Overdue", "متأخر")}</option>
            <option value="DUE_SOON">{tr(locale, "Due soon / SLA alert", "قارب الاستحقاق / تنبيه SLA")}</option>
            <option value="PENDING">{tr(locale, "Pending within TAT", "ضمن زمن الإنجاز")}</option>
            <option value="NO_TAT">{tr(locale, "No TAT snapshot", "بدون لقطة زمن إنجاز")}</option>
          </select>
          <select name="status" aria-label={tr(locale, "Worklist result state", "حالة نتيجة العمل")} defaultValue={status}>
            <option value="">{tr(locale, "All statuses", "كل الحالات")}</option>
            <option value="COLLECTED">{statusLabel(locale, "COLLECTED")}</option>
            <option value="IN_PROGRESS">{statusLabel(locale, "IN_PROGRESS")}</option>
            <option value="RESULTED">{statusLabel(locale, "RESULTED")}</option>
            <option value="VERIFIED">{statusLabel(locale, "VERIFIED")}</option>
          </select>
          <button type="submit" className="secondary-button"><SystemIcon name="search" size={15} />{tr(locale, "Filter", "تصفية")}</button>
          {(q || status || departmentId || branchId || priority || specimenStatus || due || analyzer) && <Link className="secondary-link" href="/worklists">{tr(locale, "Clear", "مسح")}</Link>}
        </form>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>{tr(locale, "Accession", "رقم الطلب")}</th><th>{tr(locale, "Patient", "المريض")}</th><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Priority", "الأولوية")}</th><th>{tr(locale, "Department", "القسم")}</th><th>{tr(locale, "Specimen", "العينة")}</th><th>{tr(locale, "Location", "الموقع")}</th><th>{tr(locale, "Analyzer", "جهاز التحليل")}</th><th>{tr(locale, "TAT / Due", "زمن الإنجاز / الاستحقاق")}</th><th>{tr(locale, "Result", "النتيجة")}</th><th>{tr(locale, "Validation", "التحقق")}</th><th>{tr(locale, "Flags", "الإشارات")}</th><th></th></tr></thead>
          <tbody>
            {visibleItems.length === 0 ? <tr><td colSpan={13} className="empty-state"><TableEmptyState title={tr(locale, "No received specimens are waiting for laboratory work.", "لا توجد عينات مستلمة بانتظار العمل المخبري.")} description={tr(locale, "No eligible received or in-process specimens match these filters. Review branch, department, priority, analyzer and specimen state.", "لا توجد عينات مستلمة أو قيد العمل مؤهلة تطابق الفلاتر. راجع الفرع والقسم والأولوية والجهاز وحالة العينة.")} action={{ href: "/worklists", label: tr(locale, "Clear filters", "مسح الفلاتر") }} /></td></tr> :
              visibleItems.map(item => {
                const readySpecimen = item.specimenLinks.map(link => link.specimen).find(specimen =>
                  ["RECEIVED","IN_PROCESS"].includes(specimen.status) &&
                  (!specimenStatusFilter || specimen.status === specimenStatusFilter) &&
                  Boolean(specimen.currentBranchId) &&
                  worklistBranchIds.includes(specimen.currentBranchId!)
                );
                const result = item.results[0];
                const criticalCount = result?.values.filter(value => value.isCritical).length || 0;
                const abnormalCount = result?.values.filter(value => value.isAbnormal).length || 0;
                const tatState = tatWorkState(item.tatDueAt, item.status, now, item.tatAlertAt);
                const tatRemaining = tatRemainingMinutes(item.tatDueAt, now);
                const latestTatEscalation = item.tatEscalations[0] || null;
                const readySpecimenBranchIds = [...new Set(item.specimenLinks
                  .map(link => link.specimen)
                  .filter(specimen =>
                    ["RECEIVED","IN_PROCESS"].includes(specimen.status)
                    && Boolean(specimen.currentBranchId)
                    && worklistBranchIds.includes(specimen.currentBranchId!)
                  )
                  .map(specimen => specimen.currentBranchId!))];
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
                      <strong className={tatState === "OVERDUE" ? "critical-text" : tatState === "DUE_SOON" ? "tat-due-soon" : ""}>
                        {tatState === "OVERDUE" && tatRemaining !== null
                          ? tr(locale, `Overdue ${formatTatMinutes(tatRemaining)}`, `متأخر ${formatTatMinutes(tatRemaining)}`)
                          : tatState === "DUE_SOON" && tatRemaining !== null
                            ? tr(locale, `Due soon · ${formatTatMinutes(tatRemaining)} remaining`, `قارب الاستحقاق · متبقٍ ${formatTatMinutes(tatRemaining)}`)
                            : tatState === "PENDING" && tatRemaining !== null
                              ? tr(locale, `${formatTatMinutes(tatRemaining)} remaining`, `متبقٍ ${formatTatMinutes(tatRemaining)}`)
                              : tr(locale, "Completed", "مكتمل")}
                      </strong>
                      <br/><small>{<SystemDateText value={item.tatDueAt.toISOString()} timeZone={item.order.orderingBranch.timezone} />} · {item.tatMinutesSnapshot ?? "—"} {tr(locale, "min", "دقيقة")}{item.tatSnapshotSource === "SLA_POLICY" ? " · SLA" : ""}</small>
                      {item.tatFirstEscalationAt ? <><br/><small>{tr(locale, "Escalation starts", "بدء التصعيد")}: {<SystemDateText value={item.tatFirstEscalationAt.toISOString()} timeZone={item.order.orderingBranch.timezone} />} · {tr(locale, "max", "حد أقصى")} {item.tatMaxEscalationLevelSnapshot || 1}</small></> : null}
                      {latestTatEscalation ? <div className={latestTatEscalation.status === "OPEN" ? "form-warning" : "muted"}>
                        <strong>{tr(locale, "TAT escalation", "تصعيد TAT")} L{latestTatEscalation.level} · {statusLabel(locale, latestTatEscalation.status)}</strong>
                        <br/><small>{<SystemDateText value={latestTatEscalation.escalationDueAtSnapshot.toISOString()} timeZone={item.order.orderingBranch.timezone} />} · {tr(locale, "recipients", "المستلمون")}: {latestTatEscalation.recipientCount}</small>
                        {latestTatEscalation.status === "OPEN" && permissions.has("worklists.tat_escalations.acknowledge") && <TatEscalationAcknowledge
                          orderItemId={item.id}
                          eventId={latestTatEscalation.id}
                          level={latestTatEscalation.level}
                          locale={locale}
                        />}
                      </div> : null}
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
      {invalidCursor && <p className="muted" role="status">{tr(locale,
        "Invalid or outdated worklist page marker. Showing the first page.",
        "مؤشر صفحة قائمة العمل غير صالح أو قديم؛ تُعرض الصفحة الأولى."
      )}</p>}
      <nav className="result-actions no-print" aria-label={tr(locale, "Worklist pagination", "صفحات قائمة العمل")}>
        <span>{tr(locale, "Up to 50 results per page · ordered by registration time", "حتى 50 فحصًا بالصفحة · مرتبة بحسب وقت التسجيل")}</span>
        {params.after && <Link className="secondary-link" href={firstPageHref}>{tr(locale, "First page", "الصفحة الأولى")}</Link>}
        {worklistWindow.hasNext && nextPageHref && <Link className="secondary-link" rel="next" href={nextPageHref}>{tr(locale, "Next 50 tests", "الـ50 فحصًا التالية")}</Link>}
      </nav>
    </section>
  </main>;
}
