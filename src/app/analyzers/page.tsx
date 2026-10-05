import Link from "next/link";
import { permissionSet, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AnalyzerManager } from "@/components/analyzer-manager";
import { AnalyzerMessageReplayButton } from "@/components/analyzer-message-replay-button";

export const dynamic = "force-dynamic";

export default async function AnalyzersPage() {
  const session = await requirePermission("analyzers.view");
  const permissions = permissionSet(session);
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [analyzers, branches, departments, tests, messages, resultImports] = await Promise.all([
    prisma.analyzer.findMany({
      where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
      include: {
        branch: true,
        department: true,
        credentials: { orderBy: { createdAt: "desc" }, take: 5 },
        mappings: {
          include: { test: true, component: true },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
      orderBy: [{ branch: { nameEn: "asc" } }, { code: "asc" }],
    }),
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: branchIds }, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.department.findMany({
      where: {
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        OR: [{ branchId: null }, { branchId: { in: branchIds } }],
      },
      select: { id: true, code: true, nameEn: true, branchId: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: {
        id: true,
        code: true,
        nameEn: true,
        components: {
          where: { status: "ACTIVE" },
          select: { id: true, code: true, nameEn: true },
          orderBy: { displayOrder: "asc" },
        },
      },
      orderBy: { nameEn: "asc" },
    }),
    prisma.analyzerMessage.findMany({
      where: { branchId: { in: branchIds } },
      include: { analyzer: true },
      orderBy: { receivedAt: "desc" },
      take: 100,
    }),
    prisma.analyzerResultImport.findMany({
      where: { analyzer: { branchId: { in: branchIds } } },
      include: {
        analyzer: true,
        mapping: { include: { test: true, component: true } },
        orderItem: true,
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Analyzer Integration</p>
        <h1>Analyzers & Interface Inbox</h1>
        <p className="muted">The core LIS receives authenticated raw messages from a separately deployable Analyzer Bridge. Device serial/TCP logic stays outside the web application.</p>
      </div>
      <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
    </header>

    {permissions.has("analyzers.manage") && <AnalyzerManager
      branches={branches}
      departments={departments}
      tests={tests}
      analyzers={analyzers.map(item => ({ id: item.id, code: item.code, name: item.name, branchId: item.branchId }))}
    />}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Analyzer Registry</h2><span>{analyzers.length} analyzer(s)</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Analyzer</th><th>Branch</th><th>Protocol</th><th>Transport</th><th>Credentials</th><th>Mappings</th><th>Status</th></tr></thead>
        <tbody>{analyzers.length === 0 ? <tr><td colSpan={7} className="empty-state">No analyzers registered.</td></tr> : analyzers.map(item => <tr key={item.id}>
          <td><strong>{item.code} — {item.name}</strong><br/><small>{[item.manufacturer, item.model, item.serialNumber].filter(Boolean).join(" · ") || "No device metadata"}</small></td>
          <td>{item.branch.nameEn}{item.department ? " · " + item.department.nameEn : ""}</td>
          <td>{item.protocol}</td>
          <td>{item.transport}</td>
          <td>{item.credentials.filter(credential => credential.status === "ACTIVE").length} active</td>
          <td>{item.mappings.filter(mapping => mapping.status === "ACTIVE").length} shown active</td>
          <td>{item.status}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Raw Message Inbox</h2><span>{messages.length} recent</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Received</th><th>Analyzer</th><th>Bridge message</th><th>Protocol</th><th>Status</th><th>Attempts</th><th>Error</th><th>Payload hash</th><th>Action</th></tr></thead>
        <tbody>{messages.length === 0 ? <tr><td colSpan={9} className="empty-state">No analyzer messages received.</td></tr> : messages.map(item => <tr key={item.id}>
          <td>{item.receivedAt.toISOString().replace("T"," ").slice(0,19)}</td>
          <td>{item.analyzer.code} — {item.analyzer.name}</td>
          <td>{item.bridgeMessageId}</td>
          <td>{item.protocol}</td>
          <td>{item.status}</td>
          <td>{item.attempts}</td>
          <td>{item.errorCode || item.errorText || "—"}</td>
          <td><code>{item.payloadHash.slice(0,16)}…</code></td>
          <td>{permissions.has("analyzers.replay") && ["ERROR","DEAD_LETTER"].includes(item.status) ? <AnalyzerMessageReplayButton messageId={item.id} /> : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>


    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Normalized Result Staging</h2><span>{resultImports.length} recent</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Created</th><th>Analyzer</th><th>Observation</th><th>Barcode</th><th>Analyzer code</th><th>LIS target</th><th>Raw value</th><th>Status</th><th>Error</th></tr></thead>
        <tbody>{resultImports.length === 0 ? <tr><td colSpan={9} className="empty-state">No normalized analyzer observations staged.</td></tr> : resultImports.map(item => <tr key={item.id}>
          <td>{item.createdAt.toISOString().replace("T"," ").slice(0,19)}</td>
          <td>{item.analyzer.code}</td>
          <td>{item.bridgeObservationId}</td>
          <td><strong>{item.barcodeSnapshot || "—"}</strong></td>
          <td>{item.analyzerTestCode}</td>
          <td>{item.mapping ? item.mapping.test.code + (item.mapping.component ? " · " + item.mapping.component.code : "") : "—"}</td>
          <td><strong>{item.rawValue}</strong>{item.rawUnit ? " " + item.rawUnit : ""}</td>
          <td>{item.status}</td>
          <td>{item.errorCode ? item.errorCode + (item.errorText ? " · " + item.errorText : "") : "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    <section className="detail-grid detail-section">
      {analyzers.map(item => <article className="table-card" key={item.id}>
        <div className="table-toolbar"><h2>{item.code} Mappings</h2><span>{item.mappings.length} shown</span></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Analyzer code</th><th>LIS target</th><th>Unit</th><th>Effective</th><th>Status</th></tr></thead>
          <tbody>{item.mappings.length === 0 ? <tr><td colSpan={5} className="empty-state">No mappings configured.</td></tr> : item.mappings.map(mapping => <tr key={mapping.id}>
            <td><strong>{mapping.analyzerTestCode}</strong></td>
            <td>{mapping.test.code}{mapping.component ? " · " + mapping.component.code : ""}</td>
            <td>{mapping.analyzerUnitCode || "—"}</td>
            <td>{mapping.effectiveFrom.toISOString().slice(0,10)} → {mapping.effectiveTo?.toISOString().slice(0,10) || "Open"}</td>
            <td>{mapping.status}</td>
          </tr>)}</tbody>
        </table></div>
      </article>)}
    </section>
  </main>;
}
