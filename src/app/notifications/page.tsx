import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotificationCenterActions } from "@/components/notification-center-actions";
import { statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await requirePermission("notifications.view");
  const permissions = permissionSet(session);
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";

  const [notifications, preferences, templates, deliveryCounts] = await Promise.all([
    prisma.notification.findMany({
      where: {
        organizationId: session.user.organizationId,
        recipientUserId: session.user.id,
      },
      include: { deliveries: { orderBy: { createdAt: "asc" } }, branch: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.notificationPreference.findMany({
      where: { userId: session.user.id },
      orderBy: [{ eventCode: "asc" }, { channel: "asc" }],
    }),
    permissions.has("notifications.manage")
      ? prisma.notificationTemplate.findMany({
          where: { organizationId: session.user.organizationId },
          orderBy: [{ eventCode: "asc" }, { channel: "asc" }],
          take: 200,
        })
      : Promise.resolve([]),
    permissions.has("notifications.dispatch")
      ? prisma.notificationDelivery.groupBy({
          by: ["status"],
          where: { notification: { organizationId: session.user.organizationId } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const unread = notifications.filter(item => !item.readAt);
  const deliveryMap = new Map(deliveryCounts.map(item => [item.status, item._count._all]));
  const severityLabel = (value: string) => value === "INFO" ? tr(locale, "Info", "معلومة") : value === "WARNING" ? tr(locale, "Warning", "تحذير") : value === "CRITICAL" ? tr(locale, "Critical", "حرج") : value;
  const channelLabel = (value: string) => value === "IN_APP" ? tr(locale, "In-app", "داخل النظام") : value === "EMAIL" ? tr(locale, "Email", "البريد الإلكتروني") : value === "SMS" ? tr(locale, "SMS", "رسالة نصية") : value === "WHATSAPP" ? tr(locale, "WhatsApp", "واتساب") : value;
  const eventLabel = (value: string) => value === "CRITICAL_RESULT_OPENED" ? tr(locale, "Critical result opened", "فتح نتيجة حرجة") : value === "CRITICAL_RESULT_ESCALATED" ? tr(locale, "Critical result escalated", "تصعيد نتيجة حرجة") : value === "REPORT_RELEASED" ? tr(locale, "Report released", "إصدار تقرير") : value === "TAT_BREACH" ? tr(locale, "TAT breach", "تجاوز زمن الإنجاز") : value === "APPOINTMENT_REMINDER" ? tr(locale, "Appointment reminder", "تذكير بموعد") : value;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Communication & Alerts", "الاتصالات والتنبيهات")}</p>
        <h1>{tr(locale, "Notifications", "الإشعارات")}</h1>
        <p className="muted">{tr(locale, "Event-driven in-app and outbound notification queue with recipient preferences, retry history and delivery evidence.", "مركز إشعارات قائم على الأحداث يشمل إشعارات داخل النظام وقنوات خارجية وتفضيلات المستلمين وسجل إعادة المحاولة وأدلة التسليم.")}</p>
      </div>
    </header>

    <section className="workflow-summary">
      <article className={unread.length ? "summary-attention" : ""}><span>{tr(locale, "Unread", "غير مقروءة")}</span><strong>{unread.length}</strong><small>{tr(locale, "personal notifications", "إشعارات شخصية")}</small></article>
      <article><span>{tr(locale, "Pending outbound", "صادر بانتظار الإرسال")}</span><strong>{deliveryMap.get("PENDING") || 0}</strong><small>{tr(locale, "awaiting provider dispatch", "بانتظار مزود الإرسال")}</small></article>
      <article><span>{tr(locale, "Failed retryable", "فاشلة قابلة لإعادة المحاولة")}</span><strong>{deliveryMap.get("FAILED") || 0}</strong><small>{tr(locale, "scheduled for retry", "مجدولة لإعادة المحاولة")}</small></article>
      <article className={(deliveryMap.get("DEAD_LETTER") || 0) > 0 ? "summary-attention" : ""}><span>{tr(locale, "Dead letter", "متعذرة المعالجة")}</span><strong>{deliveryMap.get("DEAD_LETTER") || 0}</strong><small>{tr(locale, "requires investigation", "تحتاج إلى مراجعة")}</small></article>
    </section>

    <NotificationCenterActions
      notificationIds={unread.map(item => item.id)}
      preferences={preferences.map(item => ({ eventCode: item.eventCode, channel: item.channel, enabled: item.enabled }))}
      canManage={permissions.has("notifications.manage")}
      canDispatch={permissions.has("notifications.dispatch")}
      locale={locale}
    />

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "My Notifications", "إشعاراتي")}</h2><span>{notifications.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Time", "الوقت")}</th><th>{tr(locale, "Event", "الحدث")}</th><th>{tr(locale, "Message", "الرسالة")}</th><th>{tr(locale, "Branch", "الفرع")}</th><th>{tr(locale, "Severity", "الشدة")}</th><th>{tr(locale, "Delivery", "التسليم")}</th><th>{tr(locale, "Read", "القراءة")}</th></tr></thead>
        <tbody>{notifications.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr(locale, "No notifications yet.", "لا توجد إشعارات حتى الآن.")}</td></tr> : notifications.map(item => <tr key={item.id}>
          <td>{item.createdAt.toISOString().replace("T"," ").slice(0,19)}</td>
          <td><strong>{eventLabel(item.eventCode)}</strong></td>
          <td><strong>{item.title}</strong><br/><small>{item.body}</small></td>
          <td>{item.branch?.code || tr(locale, "ORG", "المؤسسة")}</td>
          <td><span className={"status-badge notification-" + item.severity.toLowerCase()}>{severityLabel(item.severity)}</span></td>
          <td>{item.deliveries.map(delivery => channelLabel(delivery.channel) + ": " + statusLabel(locale, delivery.status)).join(" · ") || "—"}</td>
          <td>{item.readAt ? item.readAt.toISOString().replace("T"," ").slice(0,16) : tr(locale, "Unread", "غير مقروء")}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {permissions.has("notifications.manage") && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Templates", "القوالب")}</h2><span>{templates.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Event", "الحدث")}</th><th>{tr(locale, "Channel", "القناة")}</th><th>{tr(locale, "Subject", "الموضوع")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
        <tbody>{templates.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr(locale, "No templates configured.", "لا توجد قوالب مهيأة.")}</td></tr> : templates.map(item => <tr key={item.id}>
          <td><strong>{item.code}</strong></td><td>{eventLabel(item.eventCode)}</td><td>{channelLabel(item.channel)}</td><td>{locale === "ar" ? item.subjectAr || item.subjectEn || "—" : item.subjectEn || "—"}</td><td>{item.enabled ? statusLabel(locale, "ACTIVE") : statusLabel(locale, "DISABLED")}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </main>;
}
