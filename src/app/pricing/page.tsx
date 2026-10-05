import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PricingManager } from "@/components/pricing-manager";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const session = await requirePermission("pricing.view");

  const accessibleBranchIds = session.user.branchScopes.map(scope => scope.branchId);

  const [priceLists, branches, clients, contracts, tests, packages] = await Promise.all([
    prisma.priceList.findMany({
      where: { organizationId: session.user.organizationId, OR: [{ scopeType: { not: "BRANCH" } }, { branchId: { in: accessibleBranchIds } }] },
      include: { _count: { select: { items: true, packageItems: true } } },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { nameEn: "asc" }],
      take: 200,
    }),
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, id: { in: accessibleBranchIds }, status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
    }),
    prisma.client.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
    }),
    prisma.contract.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      orderBy: { nameEn: "asc" },
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
    prisma.commercialPackage.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
      orderBy: { nameEn: "asc" },
    }),
  ]);

  return <main className="catalog-shell">
    <header className="page-header">
      <div>
        <p className="eyebrow">Billing Configuration</p>
        <h1>Pricing</h1>
        <p className="muted">Effective-dated organization, branch, client and contract price lists. Historical orders keep their original price snapshots.</p>
      </div>
      <Link className="secondary-link" href="/dashboard">Back to Dashboard</Link>
    </header>

    <PricingManager
      branches={branches.map(x => ({ id: x.id, code: x.code, nameEn: x.nameEn }))}
      clients={clients.map(x => ({ id: x.id, code: x.code, nameEn: x.nameEn }))}
      contracts={contracts.map(x => ({ id: x.id, code: x.code, nameEn: x.nameEn, clientId: x.clientId }))}
      tests={tests}
      packages={packages}
      priceLists={priceLists.map(x => ({ id: x.id, code: x.code, nameEn: x.nameEn, currency: x.currency }))}
      defaultCurrency={session.user.organization.defaultCurrency}
    />

    <section className="table-card">
      <div className="table-toolbar"><h2>Price Lists</h2><span>{priceLists.length} shown</span></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Scope</th><th>Currency</th><th>Priority</th><th>Effective</th><th>Items</th><th>Status</th></tr></thead>
          <tbody>
            {priceLists.length === 0 ? <tr><td colSpan={8} className="empty-state">No price lists configured yet.</td></tr> :
              priceLists.map(list => <tr key={list.id}>
                <td><strong>{list.code}</strong></td>
                <td>{list.nameEn}</td>
                <td>{list.scopeType}</td>
                <td>{list.currency}</td>
                <td>{list.priority}</td>
                <td>{list.effectiveFrom.toISOString().slice(0,10)} → {list.effectiveTo ? list.effectiveTo.toISOString().slice(0,10) : "Open"}</td>
                <td>{list._count.items} tests · {list._count.packageItems} packages</td>
                <td>{list.status}</td>
              </tr>)
            }
          </tbody>
        </table>
      </div>
    </section>
  </main>;
}
