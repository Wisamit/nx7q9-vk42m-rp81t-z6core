import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function CriticalResultsPage() {
  const session = await requirePermission("critical.communicate");
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);
  const now = new Date();

  const events = await prisma.criticalResultEvent.findMany({
    where: {
      status: "OPEN",
      result: {
        organizationId: session.user.organizationId,
        performingBranchId: { in: branchIds },
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
        <p className="eyebrow">Critical Result Escalation</p>
        <h1>Open Critical Results</h1>
        <p className="muted">Branch-scoped queue for acknowledgement deadlines, communication attempts and escalation levels.</p>
      </div>
      <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
    </header>

    <section className="table-card">
      <div className="table-toolbar"><h2>Active critical events</h2><span>{events.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Patient / Order</th><th>Test</th><th>Branch</th><th>Detected</th><th>Acknowledgement due</th><th>Escalation</th><th>Last communication</th><th>Action</th></tr></thead>
        <tbody>{events.length === 0 ? <tr><td colSpan={8} className="empty-state">No open critical result events in your authorized branches.</td></tr> : events.map(event => {
          const overdue = Boolean(event.acknowledgementDueAt && event.acknowledgementDueAt < now);
          const last = event.communications[0];
          return <tr key={event.id}>
            <td><strong>{event.result.orderItem.order.patient.fullNameEn}</strong><br/><small>{event.result.orderItem.order.accessionNumber}</small></td>
            <td><strong>{event.result.orderItem.test.code}</strong><br/><small>{event.result.orderItem.test.nameEn}</small></td>
            <td>{event.result.performingBranch.nameEn}</td>
            <td>{event.detectedAt.toISOString().replace("T"," ").slice(0,19)}</td>
            <td>{event.acknowledgementDueAt
              ? <strong className={overdue ? "delta-exceeded" : ""}>{event.acknowledgementDueAt.toISOString().replace("T"," ").slice(0,19)}{overdue ? " · OVERDUE" : ""}</strong>
              : "No policy"}</td>
            <td>Level {event.escalationLevel}{event.maxEscalationLevelSnapshot !== null ? ` / ${event.maxEscalationLevelSnapshot}` : ""}<br/><small>{event.nextEscalationDueAt ? "Next: " + event.nextEscalationDueAt.toISOString().replace("T"," ").slice(0,19) : "—"}</small></td>
            <td>{last ? <><strong>{last.outcome}</strong><br/><small>{last.communicatedAt.toISOString().replace("T"," ").slice(0,19)} · {last.recipientName}</small></> : "No communication yet"}</td>
            <td><Link className="secondary-link" href={`/worklists/${event.result.orderItemId}`}>Open Result</Link></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
  </main>;
}
