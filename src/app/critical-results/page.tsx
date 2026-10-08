import Link from "next/link";
import { authorizedDepartmentIds, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getUiLocale, tr } from "@/lib/ui-i18n";

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export const dynamic = "force-dynamic";

export default async function CriticalResultsPage() {
  const session = await requirePermission("critical.communicate");
  const locale = getUiLocale(session.user.preferredLocale);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);
  const departmentIds = authorizedDepartmentIds(session);
  const now = new Date();

  const events = await prisma.criticalResultEvent.findMany({
    where: {
      status: "OPEN",
      result: {
        organizationId: session.user.organizationId,
        performingBranchId: { in: branchIds },
        ...(departmentIds.length > 0 ? { orderItem: { test: { departmentId: { in: departmentIds } } } } : {}),
      },
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
    orderBy: [{ acknowledgementDueAt: "asc" }, { detectedAt: "asc" }],
    take: 300,
  });

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
      <div className="table-toolbar"><h2>{tr(locale, "Active critical events", "الأحداث الحرجة النشطة")}</h2><span>{events.length} {tr(locale, "shown", "معروضة")}</span></div>
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
            <td>{event.detectedAt.toISOString().replace("T"," ").slice(0,19)}</td>
            <td>{event.acknowledgementDueAt
              ? <strong className={overdue ? "delta-exceeded" : ""}>{event.acknowledgementDueAt.toISOString().replace("T"," ").slice(0,19)}{overdue ? " · " + tr(locale, "OVERDUE", "متأخر") : ""}</strong>
              : tr(locale, "No policy", "لا توجد سياسة")}</td>
            <td>{tr(locale, "Level", "المستوى")} {event.escalationLevel}{event.maxEscalationLevelSnapshot !== null ? ` / ${event.maxEscalationLevelSnapshot}` : ""}<br/><small>{event.nextEscalationDueAt ? tr(locale, "Next", "التالي") + ": " + event.nextEscalationDueAt.toISOString().replace("T"," ").slice(0,19) : "—"}</small></td>
            <td>{last ? <><strong>{last.outcome}</strong><br/><small>{last.communicatedAt.toISOString().replace("T"," ").slice(0,19)} · {last.recipientName}</small></> : tr(locale, "No communication yet", "لا يوجد تواصل بعد")}</td>
            <td><Link className="secondary-link" href={`/worklists/${event.result.orderItemId}`}>{tr(locale, "Open Result", "فتح النتيجة")}</Link></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
  </main>;
}
