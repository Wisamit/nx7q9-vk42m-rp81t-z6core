import Link from "next/link";
import { IntegrationManager } from "@/components/integration-manager";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { statusLabel, tr } from "@/lib/ui-i18n";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await requirePermission("integrations.view");
  const permissions = permissionSet(session);
  const locale = session.user.preferredLocale === "ar" ? "ar" : "en";
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, tests, endpoints, mappings, apiKeys, subscriptions, messages, deliveries] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: {
        id: true, code: true, nameEn: true, nameAr: true,
        components: {
          where: { status: "ACTIVE" },
          select: { id: true, code: true, nameEn: true, nameAr: true },
          orderBy: { displayOrder: "asc" },
        },
      },
      orderBy: { nameEn: "asc" },
      take: 1000,
    }),
    prisma.integrationEndpoint.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
      },
      include: { branch: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.terminologyMapping.findMany({
      where: { organizationId: session.user.organizationId },
      include: { test: true, component: true },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.integrationApiKey.findMany({
      where: {
        organizationId: session.user.organizationId,
        endpoint: { OR: [{ branchId: null }, { branchId: { in: branchIds } }] },
      },
      include: { endpoint: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.webhookSubscription.findMany({
      where: {
        organizationId: session.user.organizationId,
        endpoint: { OR: [{ branchId: null }, { branchId: { in: branchIds } }] },
      },
      include: { endpoint: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.integrationMessage.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
      },
      include: { endpoint: true },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.webhookDelivery.findMany({
      where: {
        organizationId: session.user.organizationId,
        subscription: { endpoint: { OR: [{ branchId: null }, { branchId: { in: branchIds } }] } },
      },
      include: { subscription: { include: { endpoint: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const failedMessages = messages.filter(item => ["FAILED","DEAD_LETTER","REJECTED"].includes(item.status)).length;
  const pendingWebhooks = deliveries.filter(item => ["QUEUED","FAILED"].includes(item.status)).length;
  const localizedBranchName = (branch: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn;
  const directionLabel = (value: string) =>
    value === "INBOUND" ? tr(locale, "Inbound", "وارد") :
    value === "OUTBOUND" ? tr(locale, "Outbound", "صادر") :
    value === "BIDIRECTIONAL" ? tr(locale, "Bidirectional", "ثنائي الاتجاه") : value;
  const eventLabel = (value: string) =>
    value === "diagnostic_report.released" ? tr(locale, "Diagnostic report released", "إصدار تقرير تشخيصي") :
    value === "diagnostic_report.amended" ? tr(locale, "Diagnostic report amended", "تعديل تقرير تشخيصي") : value;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">{tr(locale, "Interoperability", "التشغيل البيني")}</p>
        <h1>{tr(locale, "Integrations & Standards", "التكاملات والمعايير")}</h1>
        <p className="muted">{tr(locale, "FHIR R4 APIs, HL7 v2 message intake/outbox, effective terminology mappings, scoped API keys and retryable webhooks.", "واجهات FHIR R4 ورسائل HL7 v2 الواردة والصادرة وربط المصطلحات المؤرخ بسريانه ومفاتيح API محددة الصلاحيات وWebhooks قابلة لإعادة المحاولة.")}</p>
      </div>
      <div className="result-actions"><Link className="secondary-link" href="/dashboard">{tr(locale, "Back to Dashboard", "العودة إلى لوحة التحكم")}</Link></div>
    </header>

    <section className="workflow-summary">
      <article><span>{tr(locale, "Endpoints", "نقاط التكامل")}</span><strong>{endpoints.filter(item => item.status === "ACTIVE").length}</strong><small>{tr(locale, "active integrations", "تكاملات نشطة")}</small></article>
      <article><span>{tr(locale, "Terminology", "المصطلحات")}</span><strong>{mappings.filter(item => item.status === "ACTIVE").length}</strong><small>{tr(locale, "active mappings", "روابط نشطة")}</small></article>
      <article className={failedMessages ? "summary-attention" : ""}><span>{tr(locale, "Message exceptions", "استثناءات الرسائل")}</span><strong>{failedMessages}</strong><small>{tr(locale, "failed / rejected / dead-letter", "فاشلة / مرفوضة / متعذرة المعالجة")}</small></article>
      <article className={pendingWebhooks ? "summary-attention" : ""}><span>{tr(locale, "Webhook queue", "قائمة Webhook")}</span><strong>{pendingWebhooks}</strong><small>{tr(locale, "queued or retrying", "في الانتظار أو قيد إعادة المحاولة")}</small></article>
    </section>

    <IntegrationManager
      locale={locale}
      branches={branches}
      tests={tests}
      endpoints={endpoints.map(endpoint => ({
        id: endpoint.id,
        code: endpoint.code,
        name: endpoint.name,
        endpointType: endpoint.endpointType,
        direction: endpoint.direction,
      }))}
      canManage={permissions.has("integrations.manage")}
      canManageKeys={permissions.has("integrations.api_keys.manage")}
      canReplay={permissions.has("integrations.replay")}
    />

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Integration Endpoints", "نقاط التكامل")}</h2><span>{endpoints.length} {tr(locale, "shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Scope", "النطاق")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "Direction", "الاتجاه")}</th><th>{tr(locale, "Auth", "المصادقة")}</th><th>URL</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
        <tbody>{endpoints.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr(locale, "No integration endpoints configured.", "لا توجد نقاط تكامل مهيأة.")}</td></tr> : endpoints.map(endpoint => <tr key={endpoint.id}>
          <td><strong>{endpoint.code}</strong></td>
          <td>{endpoint.name}</td>
          <td>{endpoint.branch ? endpoint.branch.code + " — " + localizedBranchName(endpoint.branch) : tr(locale, "Organization", "المؤسسة")}</td>
          <td>{endpoint.endpointType}</td><td>{directionLabel(endpoint.direction)}</td><td>{endpoint.authType}</td>
          <td><small>{endpoint.baseUrl || tr(locale, "Internal/API intake", "استقبال داخلي / API")}</small></td>
          <td><span className={"status-badge status-" + endpoint.status.toLowerCase()}>{statusLabel(locale, endpoint.status)}</span></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Terminology Mappings", "روابط المصطلحات")}</h2><span>{mappings.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Target", "الهدف")}</th><th>{tr(locale, "System", "النظام")}</th><th>{tr(locale, "Code", "الرمز")}</th><th>{tr(locale, "Display", "اسم العرض")}</th><th>{tr(locale, "Effective", "السريان")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>{mappings.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No terminology mappings.", "لا توجد روابط مصطلحات.")}</td></tr> : mappings.map(mapping => <tr key={mapping.id}>
            <td><strong>{mapping.test.code}</strong>{mapping.component ? " / " + mapping.component.code : ""}</td>
            <td>{mapping.system}</td><td>{mapping.code}</td><td>{mapping.display || "—"}</td>
            <td>{mapping.effectiveFrom.toISOString().slice(0,10)} → {mapping.effectiveTo?.toISOString().slice(0,10) || tr(locale, "Open", "مفتوح")}</td>
            <td>{statusLabel(locale, mapping.status)}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "API Keys", "مفاتيح API")}</h2><span>{apiKeys.length} {tr(locale, "shown", "معروضة")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Name", "الاسم")}</th><th>{tr(locale, "Endpoint", "نقطة التكامل")}</th><th>{tr(locale, "Prefix", "البادئة")}</th><th>{tr(locale, "Scopes", "الصلاحيات")}</th><th>{tr(locale, "Last used", "آخر استخدام")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
          <tbody>{apiKeys.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr(locale, "No API keys.", "لا توجد مفاتيح API.")}</td></tr> : apiKeys.map(key => {
            const keyStatus = key.revokedAt ? tr(locale, "REVOKED", "ملغى") : key.expiresAt && key.expiresAt < new Date() ? tr(locale, "EXPIRED", "منتهي") : tr(locale, "ACTIVE", "نشط");
            return <tr key={key.id}>
              <td>{key.name}</td><td>{key.endpoint.code}</td><td><code>{key.keyPrefix}</code></td>
              <td>{Array.isArray(key.scopes) ? key.scopes.join(", ") : "—"}</td>
              <td>{key.lastUsedAt?.toISOString().replace("T"," ").slice(0,19) || tr(locale, "Never", "لم يُستخدم")}</td>
              <td>{keyStatus}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </article>
    </section>

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "HL7 / Integration Messages", "رسائل HL7 / التكامل")}</h2><span>{messages.length} {tr(locale, "latest", "الأحدث")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Created", "تاريخ الإنشاء")}</th><th>{tr(locale, "Endpoint", "نقطة التكامل")}</th><th>{tr(locale, "Direction", "الاتجاه")}</th><th>{tr(locale, "Type", "النوع")}</th><th>{tr(locale, "Control ID", "معرّف التحكم")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Attempts", "المحاولات")}</th></tr></thead>
          <tbody>{messages.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr(locale, "No integration messages.", "لا توجد رسائل تكامل.")}</td></tr> : messages.map(item => <tr key={item.id}>
            <td>{item.createdAt.toISOString().replace("T"," ").slice(0,19)}</td><td>{item.endpoint.code}</td><td>{directionLabel(item.direction)}</td>
            <td>{item.messageType}</td><td><small>{item.controlId || "—"}</small></td>
            <td><span className={"status-badge status-" + item.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, item.status)}</span></td><td>{item.attemptCount}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>{tr(locale, "Webhook Deliveries", "عمليات تسليم Webhook")}</h2><span>{deliveries.length} {tr(locale, "latest", "الأحدث")}</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr(locale, "Created", "تاريخ الإنشاء")}</th><th>{tr(locale, "Endpoint", "نقطة التكامل")}</th><th>{tr(locale, "Event", "الحدث")}</th><th>{tr(locale, "Status", "الحالة")}</th><th>{tr(locale, "Attempts", "المحاولات")}</th><th>HTTP</th><th>{tr(locale, "Next retry", "المحاولة التالية")}</th></tr></thead>
          <tbody>{deliveries.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr(locale, "No webhook deliveries.", "لا توجد عمليات تسليم Webhook.")}</td></tr> : deliveries.map(item => <tr key={item.id}>
            <td>{item.createdAt.toISOString().replace("T"," ").slice(0,19)}</td><td>{item.subscription.endpoint.code}</td><td>{eventLabel(item.eventType)}</td>
            <td><span className={"status-badge status-" + item.status.toLowerCase().replaceAll("_","-")}>{statusLabel(locale, item.status)}</span></td><td>{item.attemptCount}</td>
            <td>{item.lastHttpStatus || "—"}</td><td>{item.nextAttemptAt?.toISOString().replace("T"," ").slice(0,19) || "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr(locale, "Webhook Subscriptions", "اشتراكات Webhook")}</h2><span>{subscriptions.length} {tr(locale, "configured", "مهيأة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr(locale, "Endpoint", "نقطة التكامل")}</th><th>{tr(locale, "Event", "الحدث")}</th><th>{tr(locale, "Status", "الحالة")}</th></tr></thead>
        <tbody>{subscriptions.length === 0 ? <tr><td colSpan={3} className="empty-state">{tr(locale, "No webhook subscriptions.", "لا توجد اشتراكات Webhook.")}</td></tr> : subscriptions.map(item => <tr key={item.id}>
          <td>{item.endpoint.code} — {item.endpoint.name}</td><td>{eventLabel(item.eventType)}</td><td>{statusLabel(locale, item.status)}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
