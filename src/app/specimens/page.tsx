import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SpecimenActions } from "@/components/specimen-actions";

export const dynamic = "force-dynamic";

export default async function SpecimensPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const session = await requirePermission("specimens.view");
  const params = await searchParams;
  const q = params.q?.trim() || "";
  const status = params.status?.trim() || "";
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [specimens, branches] = await Promise.all([
    prisma.specimen.findMany({
      where: {
        organizationId: session.user.organizationId,
        OR: [
          { currentBranchId: { in: branchIds } },
          { order: { orderingBranchId: { in: branchIds } } },
        ],
        ...(status && ["PLANNED","COLLECTED","RECEIVED","IN_TRANSIT","IN_PROCESS","REJECTED","DISPOSED"].includes(status)
          ? { status: status as "PLANNED" | "COLLECTED" | "RECEIVED" | "IN_TRANSIT" | "IN_PROCESS" | "REJECTED" | "DISPOSED" }
          : {}),
        ...(q ? {
          AND: [{
            OR: [
              { barcode: { contains: q } },
              { order: { accessionNumber: { contains: q } } },
              { order: { patient: { patientNumber: { contains: q } } } },
              { order: { patient: { fullNameEn: { contains: q } } } },
              { order: { patient: { phone: { contains: q } } } },
            ],
          }],
        } : {}),
      },
      include: {
        order: { include: { patient: true, orderingBranch: true } },
        specimenType: true,
        container: true,
        currentBranch: true,
        collectionBranch: true,
        collectedBy: true,
        receivedBy: true,
        rejectedBy: true,
        orderItems: { include: { orderItem: true } },
        events: { orderBy: { occurredAt: "desc" }, take: 5, include: { actor: true, branch: true } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 200,
    }),
    prisma.branch.findMany({
      where: { id: { in: branchIds }, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
  ]);

  const planned = specimens.filter(item => item.status === "PLANNED").length;
  const collected = specimens.filter(item => item.status === "COLLECTED").length;
  const received = specimens.filter(item => ["RECEIVED","IN_PROCESS"].includes(item.status)).length;
  const rejected = specimens.filter(item => item.status === "REJECTED").length;

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Pre-Analytical Workflow</p>
        <h1>Specimens & Barcodes</h1>
        <p className="muted">Trace each specimen from planned collection through receipt, rejection and recollection using organization-unique barcodes.</p>
      </div>
      <div className="header-actions">
        <Link className="secondary-link" href="/orders">Orders</Link>
        <Link className="secondary-link" href="/transfers">Transfers</Link>
        <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
      </div>
    </header>

    <section className="workflow-summary">
      <article><span>Planned</span><strong>{planned}</strong><small>awaiting collection</small></article>
      <article><span>Collected</span><strong>{collected}</strong><small>awaiting receipt / routing</small></article>
      <article><span>Lab ready</span><strong>{received}</strong><small>received or in process</small></article>
      <article className={rejected ? "summary-attention" : ""}><span>Rejected</span><strong>{rejected}</strong><small>requires attention / recollection</small></article>
    </section>

    <section className="table-card">
      <div className="table-toolbar">
        <div><h2>Specimen Work Queue</h2><span>{specimens.length} shown</span></div>
        <form className="inline-search" action="/specimens" method="get">
          <input name="q" defaultValue={q} placeholder="Scan barcode or search order / patient…" autoFocus />
          <select name="status" defaultValue={status}>
            <option value="">All statuses</option>
            <option value="PLANNED">PLANNED</option>
            <option value="COLLECTED">COLLECTED</option>
            <option value="RECEIVED">RECEIVED</option>
            <option value="IN_TRANSIT">IN_TRANSIT</option>
            <option value="IN_PROCESS">IN_PROCESS</option>
            <option value="REJECTED">REJECTED</option>
          </select>
          <button className="secondary-button">Search</button>
          {(q || status) && <Link className="secondary-link" href="/specimens">Clear</Link>}
        </form>
      </div>
    </section>

    <div className="specimen-card-list">
      {specimens.length === 0 ? <section className="detail-card"><p className="empty-state">No matching specimens.</p></section> :
        specimens.map(specimen => <section className="detail-card specimen-card" key={specimen.id}>
          <div className="specimen-card-head">
            <div>
              <span className={"status-badge status-" + specimen.status.toLowerCase().replaceAll("_","-")}>{specimen.status}</span>
              <h2 className="barcode-text">{specimen.barcode}</h2>
              <p className="muted">{specimen.order.accessionNumber} · {specimen.order.patient.patientNumber} · {specimen.order.patient.fullNameEn}</p>
            </div>
            <Link className="secondary-link" href={`/orders/${specimen.orderId}`}>Open Order</Link>
          </div>

          <div className="specimen-metadata">
            <div><span>Specimen</span><strong>{specimen.specimenType?.nameEn || "Not configured"}</strong></div>
            <div><span>Container</span><strong>{specimen.container?.nameEn || "—"}</strong></div>
            <div><span>Order branch</span><strong>{specimen.order.orderingBranch.nameEn}</strong></div>
            <div><span>Current branch</span><strong>{specimen.currentBranch?.nameEn || "—"}</strong></div>
            <div><span>Linked tests</span><strong>{specimen.orderItems.map(link => link.orderItem.testCodeSnapshot).join(", ") || "—"}</strong></div>
            <div><span>Collected</span><strong>{specimen.collectedAt ? specimen.collectedAt.toISOString().replace("T"," ").slice(0,19) : "—"}</strong></div>
            <div><span>Received</span><strong>{specimen.receivedAt ? specimen.receivedAt.toISOString().replace("T"," ").slice(0,19) : "—"}</strong></div>
            <div><span>Volume</span><strong>{specimen.volume ? `${specimen.volume.toString()} ${specimen.volumeUnit || ""}` : "—"}</strong></div>
          </div>

          {specimen.status === "REJECTED" && <div className="specimen-rejection">
            <strong>{specimen.rejectionReasonCode}</strong>
            <span>{specimen.rejectionReasonText}</span>
          </div>}

          <SpecimenActions
            specimenId={specimen.id}
            barcode={specimen.barcode}
            status={specimen.status}
            specimenTypeConfigured={Boolean(specimen.specimenTypeId)}
            branches={branches}
            activeBranchId={session.activeBranchId}
          />

          <details className="specimen-history">
            <summary>Chain of custody ({specimen.events.length} recent events)</summary>
            <div className="summary-list">
              {specimen.events.map(event => <div key={event.id}>
                <span>{event.occurredAt.toISOString().replace("T"," ").slice(0,19)} · {event.branch?.code || "—"} · {event.actor?.displayNameEn || "System"}</span>
                <strong>{event.eventType}{event.fromStatus || event.toStatus ? ` · ${event.fromStatus || "NEW"} → ${event.toStatus || "—"}` : ""}</strong>
              </div>)}
            </div>
          </details>
        </section>)
      }
    </div>
  </main>;
}
