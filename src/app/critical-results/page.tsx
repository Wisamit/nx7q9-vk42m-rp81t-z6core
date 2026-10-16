import { SystemDateText } from "@/components/system-date-text";
import Link from "next/link";
import { authorizedDepartmentIds, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUiLocale, tr } from "@/lib/ui-i18n";
import { CRITICAL_QUEUE_PAGE_SIZE, criticalQueueAfterWhere, criticalQueueFilter, criticalQueuePage, decodeCriticalQueueCursor } from "@/lib/critical-results-queue";

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export const dynamic = "force-dynamic";

export default async function CriticalResultsPage({
  searchParams,
}: { searchParams: Promise<{ filter?: string; after?: string }> }) {
  const session = await requirePermission("critical.communicate");
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes
    .filter(scope => scope.branch.status === "ACTIVE")
    .map(scope => scope.branchId);
  const departmentIds = authorizedDepartmentIds(session);
  const now = new Date();

  const params = await searchParams;
  const filter = criticalQueueFilter(params.filter);
  const cursor = decodeCriticalQueueCursor(params.after, filter);
  const invalidCursor = Boolean(params.after && !cursor);
  // Live branch scopes and department policy are part of every count and
  // every page. A cursor is only a position, NEVER a permission grant.
  const queueScope = {
    status: "OPEN" as const,
    result: {
      organizationId: session.user.organizationId,
      performingBranchId: { in: branchIds },
      ...(departmentIds.length > 0
        ? { orderItem: { test: { departmentId: { in: departmentIds } } } } : {}),
    },
  };
  const overdueWhere = { AND: [queueScope, { acknowledgementDueAt: { lte: now } }] };
  // Snapshot-consistent counts and 51-record page. Missing due dates sort
  // last, so events without an approved deadline cannot hide overdue work.
  const { totalOpen, totalOverdue, pageData } = await prisma.$transaction(async tx => {
    const totalOpen = await tx.criticalResultEvent.count({ where: queueScope });
    const totalOverdue = await tx.criticalResultEvent.count({ where: overdueWhere });
    const pageData = await tx.criticalResultEvent.findMany({
      where: {
        AND: [
          queueScope,
          ...(filter === "overdue" ? [{ acknowledgementDueAt: { lte: now } }] : []),
          criticalQueueAfterWhere(cursor),
        ],
      },
      include: {
        result: {
          include: {
            performingBranch: true,
            orderItem: {
              include: {
                test: true,
                order: { include: { patient: true } },
              },
            },
          },
        },
        communications: { orderBy: { communicatedAt: "desc" }, take: 1 },
      },
      orderBy: [
        { acknowledgementDueAt: { sort: "asc", nulls: "last" } },
        { detectedAt: "asc" },
        { id: "asc" },
      ],
      take: CRITICAL_QUEUE_PAGE_SIZE + 1,
    });
    return { totalOpen, totalOverdue, pageData };
  }, { isolationLevel: "RepeatableRead", timeout: 15000 });
  const queue = criticalQueuePage(pageData, filter);
  const events = queue.rows;


  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Critical Result Escalation", "تصعيد النتائج الحرجة")}</p>
        <h1>{tr(locale, "Open Critical Results", "النتائج الحرجة المفتوحة")}</h1>
        <p className="muted">{tr(locale, "Branch-scoped queue for acknowledgement deadlines, communication attempts and escalation levels.", "قائمة حسب صلاحية الفروع لمواعيد الإقرار ومحاولات التواصل ومستويات التصعيد.")}</p>
      </div>
      <Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة للوحة التحكم")}</Link>
    </header>

    <section className="table-card">
      <div className="table-toolbar"><h2>{tr(locale, "Active critical events", "الأحداث الحرجة النشطة")}</h2>
        <span>{tr(locale, "Open", "مفتوحة")}: {totalOpen} · {tr(locale, "Overdue", "متأخرة")}: {totalOverdue} · {tr(locale, "Shown", "المعروضة")}: {events.length}</span>
      </div>
      <nav className="result-actions no-print" aria-label={tr(locale, "Critical queue filters", "فلاتر قائمة النتائج الحرجة")}>
        <Link className="secondary-link" href="/critical-results?filter=all">{tr(locale, "All open events", "كل الأحداث المفتوحة")}</Link>
        <Link className="secondary-link" href="/critical-results?filter=overdue">{tr(locale, "Overdue only", "المتأخرة فقط")}</Link>
        <span>{filter === "overdue" ? tr(locale, "Overdue filter", "فلتر المتأخرة") : tr(locale, "All open", "جميع المفتوحة")}</span>
      </nav>
      {invalidCursor && <p role="status" className="muted">{tr(locale, "Invalid or outdated page marker; showing first page.", "مؤشر الصفحة غير صالح أو قديم؛ تُعرض الصفحة الأولى.")}</p>}
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Patient / Order", "المريض / الطلب")}</th><th>{tr(locale, "Test", "الفحص")}</th><th>{tr(locale, "Critical value(s)", "القيم الحرجة")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Detected", "تم الاكتشاف")}</th><th>{tr(locale, "Acknowledgement due", "موعد الإقرار")}</th><th>{tr(locale, "Escalation", "التصعيد")}</th><th>{tr(locale, "Last communication", "آخر تواصل")}</th><th>{tr(locale, "Action", "الإجراء")}</th></tr></thead>
        <tbody>{events.length === 0 ? <tr><td colSpan={9} className="empty-state">{tr(locale, "No open critical result events in your authorized branches.", "لا توجد نتائج حرجة مفتوحة ضمن الفروع المصرح لك بها.")}</td></tr> : events.map(event => {
          const overdue = Boolean(event.acknowledgementDueAt && event.acknowledgementDueAt < now);
          const last = event.communications[0];
          const criticalSnapshot = Array.isArray(event.criticalValueSnapshot)
            ? event.criticalValueSnapshot.flatMap((item) => {
                const record = jsonRecord(item);
                return record ? [record] : [];
              })
            : [];
          return <tr key={event.id}>
            <td><strong>{event.result.orderItem.order.patient.fullNameEn}</strong><br/><small>{event.result.orderItem.order.accessionNumber}</small></td>
            <td><strong>{event.result.orderItem.test.code}</strong><br/><small>{event.result.orderItem.test.nameEn}</small></td>
            <td>{criticalSnapshot.length === 0 ? "—" : criticalSnapshot.map((value, index) => {
              const component = locale === "ar"
                ? String(value.componentNameAr || value.componentNameEn || value.componentName || value.componentCode || "")
                : String(value.componentNameEn || value.componentName || value.componentCode || "");
              const display = locale === "ar"
                ? String(value.valueTextAr || value.valueTextEn || value.displayValue || "")
                : String(value.valueTextEn || value.displayValue || "");
              const optionCode = value.qualitativeOptionCode ? String(value.qualitativeOptionCode) : "";
              return <div key={index}><strong>{component}: {display}</strong>{optionCode ? <><br/><small>{optionCode} · {String(value.flag || "")}</small></> : <><br/><small>{String(value.flag || "")}</small></>}</div>;
            })}</td>
            <td>{event.result.performingBranch.nameEn}</td>
            <td>{<SystemDateText value={event.detectedAt.toISOString()} />}</td>
            <td>{event.acknowledgementDueAt
              ? <strong className={overdue ? "delta-exceeded" : ""}>{<SystemDateText value={event.acknowledgementDueAt.toISOString()} />}{overdue ? " · " + tr(locale, "OVERDUE", "متأخر") : ""}</strong>
              : tr(locale, "No policy", "لا توجد سياسة")}</td>
            <td>{tr(locale, "Level", "المستوى")} {event.escalationLevel}{event.maxEscalationLevelSnapshot !== null ? ` / ${event.maxEscalationLevelSnapshot}` : ""}<br/><small>{event.nextEscalationDueAt ? tr(locale, "Next", "التالي") + ": " + <SystemDateText value={event.nextEscalationDueAt.toISOString()} /> : "—"}</small></td>
            <td>{last ? <><strong>{last.outcome}</strong><br/><small>{<SystemDateText value={last.communicatedAt.toISOString()} />} · {last.recipientName}</small></> : tr(locale, "No communication yet", "لا يوجد تواصل بعد")}</td>
            <td><Link className="secondary-link" href={`/worklists/${event.result.orderItemId}`}>{tr(locale, "Open Result", "فتح النتيجة")}</Link></td>
          </tr>;
        })}</tbody>
      </table></div>
      <nav className="result-actions no-print" aria-label={tr(locale, "Critical results pages", "صفحات النتائج الحرجة")}>
        <span>{tr(locale, "Up to 50 events per page; oldest acknowledgement deadlines first. Events without a due date appear last.", "حتى 50 حدثًا بالصفحة؛ مواعيد الإقرار الأقدم أولاً، والأحداث دون موعد في النهاية.")}</span>
        {params.after && <Link className="secondary-link" href={`/critical-results?filter=${filter}`}>{tr(locale, "Back to first page", "العودة لأول صفحة")}</Link>}
        {queue.hasNext && queue.nextCursor && <Link className="secondary-link" rel="next"
          href={`/critical-results?filter=${filter}&after=${queue.nextCursor}`}>{tr(locale, "Next 50 events", "الـ50 حدثًا التالية")}</Link>}
      </nav>
    </section>
  </main>;
}
