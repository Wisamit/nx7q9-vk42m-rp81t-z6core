import Link from "next/link";
import { IntegrationManager } from "@/components/integration-manager";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const session = await requirePermission("integrations.view");
  const permissions = permissionSet(session);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [branches, tests, endpoints, mappings, apiKeys, subscriptions, messages, deliveries] = await Promise.all([
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: {
        id: true, code: true, nameEn: true,
        components: {
          where: { status: "ACTIVE" },
          select: { id: true, code: true, nameEn: true },
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

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Interoperability</p>
        <h1>Integrations & Standards</h1>
        <p className="muted">FHIR R4 APIs, HL7 v2 message intake/outbox, effective terminology mappings, scoped API keys and retryable webhooks.</p>
      </div>
      <div className="result-actions"><Link className="secondary-link" href="/dashboard">Back to Dashboard</Link></div>
    </header>

    <section className="workflow-summary">
      <article><span>Endpoints</span><strong>{endpoints.filter(item => item.status === "ACTIVE").length}</strong><small>active integrations</small></article>
      <article><span>Terminology</span><strong>{mappings.filter(item => item.status === "ACTIVE").length}</strong><small>active mappings</small></article>
      <article className={failedMessages ? "summary-attention" : ""}><span>Message exceptions</span><strong>{failedMessages}</strong><small>failed / rejected / dead-letter</small></article>
      <article className={pendingWebhooks ? "summary-attention" : ""}><span>Webhook queue</span><strong>{pendingWebhooks}</strong><small>queued or retrying</small></article>
    </section>

    <IntegrationManager
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
      <div className="table-toolbar"><h2>Integration Endpoints</h2><span>{endpoints.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Code</th><th>Name</th><th>Scope</th><th>Type</th><th>Direction</th><th>Auth</th><th>URL</th><th>Status</th></tr></thead>
        <tbody>{endpoints.length === 0 ? <tr><td colSpan={8} className="empty-state">No integration endpoints configured.</td></tr> : endpoints.map(endpoint => <tr key={endpoint.id}>
          <td><strong>{endpoint.code}</strong></td>
          <td>{endpoint.name}</td>
          <td>{endpoint.branch ? endpoint.branch.code + " — " + endpoint.branch.nameEn : "Organization"}</td>
          <td>{endpoint.endpointType}</td><td>{endpoint.direction}</td><td>{endpoint.authType}</td>
          <td><small>{endpoint.baseUrl || "Internal/API intake"}</small></td>
          <td><span className={"status-badge status-" + endpoint.status.toLowerCase()}>{endpoint.status}</span></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>Terminology Mappings</h2><span>{mappings.length} shown</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Target</th><th>System</th><th>Code</th><th>Display</th><th>Effective</th><th>Status</th></tr></thead>
          <tbody>{mappings.length === 0 ? <tr><td colSpan={6} className="empty-state">No terminology mappings.</td></tr> : mappings.map(mapping => <tr key={mapping.id}>
            <td><strong>{mapping.test.code}</strong>{mapping.component ? " / " + mapping.component.code : ""}</td>
            <td>{mapping.system}</td><td>{mapping.code}</td><td>{mapping.display || "—"}</td>
            <td>{mapping.effectiveFrom.toISOString().slice(0,10)} → {mapping.effectiveTo?.toISOString().slice(0,10) || "Open"}</td>
            <td>{mapping.status}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>API Keys</h2><span>{apiKeys.length} shown</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Endpoint</th><th>Prefix</th><th>Scopes</th><th>Last used</th><th>Status</th></tr></thead>
          <tbody>{apiKeys.length === 0 ? <tr><td colSpan={6} className="empty-state">No API keys.</td></tr> : apiKeys.map(key => <tr key={key.id}>
            <td>{key.name}</td><td>{key.endpoint.code}</td><td><code>{key.keyPrefix}</code></td>
            <td>{Array.isArray(key.scopes) ? key.scopes.join(", ") : "—"}</td>
            <td>{key.lastUsedAt?.toISOString().replace("T"," ").slice(0,19) || "Never"}</td>
            <td>{key.revokedAt ? "REVOKED" : key.expiresAt && key.expiresAt < new Date() ? "EXPIRED" : "ACTIVE"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="detail-grid detail-section">
      <article className="table-card">
        <div className="table-toolbar"><h2>HL7 / Integration Messages</h2><span>{messages.length} latest</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Created</th><th>Endpoint</th><th>Direction</th><th>Type</th><th>Control ID</th><th>Status</th><th>Attempts</th></tr></thead>
          <tbody>{messages.length === 0 ? <tr><td colSpan={7} className="empty-state">No integration messages.</td></tr> : messages.map(item => <tr key={item.id}>
            <td>{item.createdAt.toISOString().replace("T"," ").slice(0,19)}</td><td>{item.endpoint.code}</td><td>{item.direction}</td>
            <td>{item.messageType}</td><td><small>{item.controlId || "—"}</small></td>
            <td><span className={"status-badge status-" + item.status.toLowerCase().replaceAll("_","-")}>{item.status}</span></td><td>{item.attemptCount}</td>
          </tr>)}</tbody>
        </table></div>
      </article>

      <article className="table-card">
        <div className="table-toolbar"><h2>Webhook Deliveries</h2><span>{deliveries.length} latest</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Created</th><th>Endpoint</th><th>Event</th><th>Status</th><th>Attempts</th><th>HTTP</th><th>Next retry</th></tr></thead>
          <tbody>{deliveries.length === 0 ? <tr><td colSpan={7} className="empty-state">No webhook deliveries.</td></tr> : deliveries.map(item => <tr key={item.id}>
            <td>{item.createdAt.toISOString().replace("T"," ").slice(0,19)}</td><td>{item.subscription.endpoint.code}</td><td>{item.eventType}</td>
            <td><span className={"status-badge status-" + item.status.toLowerCase().replaceAll("_","-")}>{item.status}</span></td><td>{item.attemptCount}</td>
            <td>{item.lastHttpStatus || "—"}</td><td>{item.nextAttemptAt?.toISOString().replace("T"," ").slice(0,19) || "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </article>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Webhook Subscriptions</h2><span>{subscriptions.length} configured</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Endpoint</th><th>Event</th><th>Status</th></tr></thead>
        <tbody>{subscriptions.length === 0 ? <tr><td colSpan={3} className="empty-state">No webhook subscriptions.</td></tr> : subscriptions.map(item => <tr key={item.id}>
          <td>{item.endpoint.code} — {item.endpoint.name}</td><td>{item.eventType}</td><td>{item.status}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </main>;
}
