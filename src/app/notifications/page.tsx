import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NotificationManager, NotificationRowActions } from "@/components/notification-manager";

export const dynamic="force-dynamic";

export default async function NotificationsPage(){
  const session=await requirePermission("notifications.view");
  const permissions=permissionSet(session);
  const branchIds=session.user.branchScopes.map(scope=>scope.branchId);

  const [inbox,templates,deliveries,preferences,branches]=await Promise.all([
    prisma.notificationDelivery.findMany({
      where:{organizationId:session.user.organizationId,recipientUserId:session.user.id,channel:"IN_APP"},
      include:{event:true},
      orderBy:{createdAt:"desc"},take:100,
    }),
    permissions.has("notifications.manage")?prisma.notificationTemplate.findMany({
      where:{organizationId:session.user.organizationId,OR:[{branchId:null},{branchId:{in:branchIds}}]},
      include:{branch:true,createdBy:true},orderBy:[{eventType:"asc"},{code:"asc"},{version:"desc"}],take:300,
    }):Promise.resolve([]),
    permissions.has("notifications.manage")||permissions.has("notifications.dispatch")?prisma.notificationDelivery.findMany({
      where:{organizationId:session.user.organizationId,event:{OR:[{branchId:null},{branchId:{in:branchIds}}]}},
      include:{event:true,template:true,recipientUser:true},orderBy:{createdAt:"desc"},take:150,
    }):Promise.resolve([]),
    prisma.notificationPreference.findMany({
      where:{organizationId:session.user.organizationId,recipientType:"USER",recipientId:session.user.id},
      select:{eventType:true,channel:true,enabled:true},
    }),
    prisma.branch.findMany({
      where:{organizationId:session.user.organizationId,id:{in:branchIds},status:"ACTIVE"},
      select:{id:true,code:true,nameEn:true},orderBy:{nameEn:"asc"},
    }),
  ]);

  const unread=inbox.filter(item=>!item.readAt).length;
  const queued=deliveries.filter(item=>item.status==="QUEUED").length;
  const failed=deliveries.filter(item=>item.status==="FAILED").length;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Notifications</p>
        <h1>Notification Center</h1>
        <p className="muted">In-app alerts plus provider-neutral email, SMS and WhatsApp delivery queues with versioned templates and delivery history.</p>
      </div>
    </header>

    <section className="workflow-summary">
      <article className={unread?"summary-attention":""}><span>Unread</span><strong>{unread}</strong><small>my in-app notifications</small></article>
      <article><span>Inbox</span><strong>{inbox.length}</strong><small>recent notifications</small></article>
      <article><span>Queued external</span><strong>{queued}</strong><small>awaiting provider dispatch</small></article>
      <article className={failed?"summary-attention":""}><span>Failed</span><strong>{failed}</strong><small>delivery attempts requiring review</small></article>
    </section>

    <section className="table-card">
      <div className="table-toolbar"><h2>My Inbox</h2><span>{inbox.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Time</th><th>Severity</th><th>Subject</th><th>Message</th><th>Status</th><th></th></tr></thead>
        <tbody>{inbox.length===0?<tr><td colSpan={6} className="empty-state">No notifications yet.</td></tr>:inbox.map(item=><tr key={item.id} className={!item.readAt?"notification-unread":""}>
          <td>{item.createdAt.toISOString().replace("T"," ").slice(0,16)}</td>
          <td><span className={"notification-severity severity-"+item.event.severity.toLowerCase()}>{item.event.severity}</span></td>
          <td><strong>{item.subject||item.event.eventType.replaceAll("_"," ")}</strong></td>
          <td className="notification-body-cell">{item.body}</td>
          <td>{item.readAt?"Read":"Unread"}</td>
          <td><NotificationRowActions id={item.id} readAt={item.readAt?.toISOString()||null} canRetry={false} status={item.status}/></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <NotificationManager branches={branches} canManage={permissions.has("notifications.manage")} preferences={preferences}/>

    {permissions.has("notifications.manage")&&<section className="table-card detail-section">
      <div className="table-toolbar"><h2>Template Versions</h2><span>{templates.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Code</th><th>Event</th><th>Channel</th><th>Locale</th><th>Scope</th><th>Version</th><th>Effective</th><th>Status</th></tr></thead>
        <tbody>{templates.length===0?<tr><td colSpan={8} className="empty-state">No notification templates configured.</td></tr>:templates.map(t=><tr key={t.id}>
          <td><strong>{t.code}</strong></td><td>{t.eventType}</td><td>{t.channel}</td><td>{t.locale}</td><td>{t.branch?.code||"Organization"}</td><td>{t.version}</td>
          <td>{t.effectiveFrom.toISOString().slice(0,10)} → {t.effectiveTo?.toISOString().slice(0,10)||"Open"}</td>
          <td><span className={"status-badge status-"+t.status.toLowerCase()}>{t.status}</span></td>
        </tr>)}</tbody>
      </table></div>
    </section>}

    {(permissions.has("notifications.manage")||permissions.has("notifications.dispatch"))&&<section className="table-card detail-section">
      <div className="table-toolbar"><h2>Delivery History</h2><span>{deliveries.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Time</th><th>Event</th><th>Channel</th><th>Recipient</th><th>Status</th><th>Attempts</th><th>Error</th><th></th></tr></thead>
        <tbody>{deliveries.length===0?<tr><td colSpan={8} className="empty-state">No delivery records.</td></tr>:deliveries.map(item=><tr key={item.id}>
          <td>{item.createdAt.toISOString().replace("T"," ").slice(0,16)}</td><td>{item.event.eventType}</td><td>{item.channel}</td>
          <td>{item.recipientUser?.displayNameEn||item.recipientAddress||item.recipientId||"—"}</td>
          <td><span className={"status-badge status-"+item.status.toLowerCase()}>{item.status}</span></td><td>{item.attemptCount}</td><td>{item.lastError||"—"}</td>
          <td><NotificationRowActions id={item.id} readAt={item.readAt?.toISOString()||null} canRetry={permissions.has("notifications.dispatch")} status={item.status}/></td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </main>;
}
