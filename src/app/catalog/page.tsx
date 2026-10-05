import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CatalogManager } from "@/components/catalog-manager";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const session = await requirePermission("catalog.view");
  const [tests, departments, specimens, containers, methods, units] = await Promise.all([prisma.labTest.findMany({
    where: { organizationId: session.user.organizationId },
    include: { department: true, specimenType: true, components: true },
    orderBy: { nameEn: "asc" },
  }), prisma.department.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }), prisma.specimenType.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }), prisma.container.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }), prisma.method.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }), prisma.unit.findMany({ where: { organizationId: session.user.organizationId, status: "ACTIVE" }, orderBy: { code: "asc" } })]);

  return (
    <main className="catalog-shell">
      <header className="page-header">
        <div><p className="eyebrow">Master Data</p><h1>Test Catalog</h1><p className="muted">Configuration-driven tests, components, specimens, methods and reference intervals.</p></div>
        <div className="header-actions"><CatalogManager departments={departments} specimens={specimens} containers={containers} methods={methods} units={units} /><Link className="secondary-link" href="/dashboard">Back to Dashboard</Link></div>
      </header>
      <section className="catalog-stats">
        <article><strong>{tests.length}</strong><span>Tests</span></article>
        <article><strong>{tests.filter((test) => test.status === "ACTIVE").length}</strong><span>Active</span></article>
        <article><strong>{tests.reduce((sum, test) => sum + test.components.length, 0)}</strong><span>Components</span></article>
      </section>
      <section className="table-card">
        <div className="table-toolbar"><h2>Tests</h2><span>Legacy catalog import will be added through controlled validation.</span></div>
        <div className="table-wrap">
          <table><thead><tr><th>Code</th><th>English name</th><th>Arabic name</th><th>Department</th><th>Specimen</th><th>Components</th><th>Status</th></tr></thead>
          <tbody>
            {tests.length === 0 ? <tr><td colSpan={7} className="empty-state">No tests configured yet.</td></tr> :
              tests.map((test) => <tr key={test.id}><td><strong>{test.code}</strong></td><td>{test.nameEn}</td><td dir="rtl">{test.nameAr || "—"}</td><td>{test.department?.nameEn || "—"}</td><td>{test.specimenType?.nameEn || "—"}</td><td>{test.components.length}</td><td>{test.status}</td></tr>)}
          </tbody></table>
        </div>
      </section>
    </main>
  );
}
