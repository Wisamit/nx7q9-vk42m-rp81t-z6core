import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotificationCenterActions } from "@/components/notification-center-actions";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await requirePermission("notifications.view");
  const permissions = permissionSet(session);

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
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);

  const unread = notifications.filter(item => !item.readAt);
  const deliveryMap = new Map(deliveryCounts.map(item => [item.status, item._count._all]));

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Communication & Alerts</p>
        <h1>Notifications</h1>
        <p className="muted">Event-driven in-app and outbound notification queue with recipient preferences, retry history and delivery evidence.</p>
      </div>
    </header>

    <section className="workflow-summary">
      <article className={unread.length ? "summary-attention" : ""}><span>Unread</span><strong>{unread.length}</strong><small>personal notifications</small></article>
      <article><span>Pending outbound</span><strong>{deliveryMap.get("PENDING") || 0}</strong><small>awaiting provider dispatch</small></article>
      <article><span>Failed retryable</span><strong>{deliveryMap.get("FAILED") || 0}</strong><small>scheduled for retry</small></article>
      <article className={(deliveryMap.get("DEAD_LETTER") || 0) > 0 ? "summary-attention" : ""}><span>Dead letter</span><strong>{deliveryMap.get("DEAD_LETTER") || 0}</strong><small>requires investigation</small></article>
    </section>

    <NotificationCenterActions
      notificationIds={unread.map(item => item.id)}
      preferences={preferences.map(item => ({ eventCode: item.eventCode, channel: item.channel, enabled: item.enabled }))}
      canManage={permissions.has("notifications.manage")}
      canDispatch={permissions.has("notifications.dispatch")}
    />

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>My Notifications</h2><span>{notifications.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Time</th><th>Event</th><th>Message</th><th>Branch</th><th>Severity</th><th>Delivery</th><th>Read</th></tr></thead>
        <tbody>{notifications.length === 0 ? <tr><td colSpan={7} className="empty-state">No notifications yet.</td></tr> : notifications.map(item => <tr key={item.id}>
          <td>{item.createdAt.toISOString().replace("T"," ").slice(0,19)}</td>
          <td><strong>{item.eventCode}</strong></td>
          <td><strong>{item.title}</strong><br/><small>{item.body}</small></td>
          <td>{item.branch?.code || "ORG"}</td>
          <td><span className={"status-badge notification-" + item.severity.toLowerCase()}>{item.severity}</span></td>
          <td>{item.deliveries.map(delivery => delivery.channel + ":" + delivery.status).join(" · ") || "—"}</td>
          <td>{item.readAt ? item.readAt.toISOString().replace("T"," ").slice(0,16) : "Unread"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {permissions.has("notifications.manage") && <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Templates</h2><span>{templates.length}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Code</th><th>Event</th><th>Channel</th><th>Subject</th><th>Status</th></tr></thead>
        <tbody>{templates.length === 0 ? <tr><td colSpan={5} className="empty-state">No templates configured.</td></tr> : templates.map(item => <tr key={item.id}>
          <td><strong>{item.code}</strong></td><td>{item.eventCode}</td><td>{item.channel}</td><td>{item.subjectEn || "—"}</td><td>{item.enabled ? "ACTIVE" : "DISABLED"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </main>;
}
