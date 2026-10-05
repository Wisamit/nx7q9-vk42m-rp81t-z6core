import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { permissionSet, requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const permissions = permissionSet(session);
  const user = session.user;
  const branch = session.activeBranch;

  return (
    <main className="dashboard-shell" dir="ltr">
      <header className="topbar">
        <div><strong>Family Lab LIS</strong><span>{user.organization.nameAr || user.organization.nameEn}</span></div>
        <div className="topbar-actions"><span>{user.displayNameAr || user.displayNameEn}</span><LogoutButton /></div>
      </header>
      <section className="dashboard-content">
        <div className="welcome-card">
          <p className="eyebrow">Dashboard</p>
          <h1>Welcome, {user.displayNameEn || user.displayNameAr}</h1>
          <p className="muted">Current branch: <strong>{branch?.nameEn || branch?.nameAr || "—"}</strong></p>
        </div>
        <div className="module-grid">
          <article><span>01</span><h2>Organization & Branches</h2><p>{permissions.has("branches.manage") ? "Manage branches and their settings." : "View authorized branches."}</p></article>
          <article><span>02</span><h2>Users & Permissions</h2><p>Role-based permissions and branch scopes.</p></article>
          <article><span>03</span><h2>Audit Log</h2><p>Track security events and significant changes.</p></article>
          <Link className="module-link" href="/catalog"><article><span>04</span><h2>Test Catalog</h2><p>Configuration-driven tests, components, specimens and ranges.</p></article></Link>
          {permissions.has("patients.view") && <Link className="module-link" href="/patients"><article><span>05</span><h2>Patients</h2><p>Central patient identity, identifiers and duplicate protection across branches.</p></article></Link>}
          {permissions.has("referrers.view") && <Link className="module-link" href="/referrers"><article><span>06</span><h2>Referrers & Clients</h2><p>Referral sources and commercial accounts kept as linked but separate master data.</p></article></Link>}
          {permissions.has("pricing.view") && <Link className="module-link" href="/pricing"><article><span>07</span><h2>Pricing</h2><p>Effective-dated organization, branch, client and contract prices.</p></article></Link>}
          {permissions.has("orders.view") && <Link className="module-link" href="/orders"><article><span>08</span><h2>Orders</h2><p>Register patient test orders with price snapshots and billing context.</p></article></Link>}
          {permissions.has("billing.view") && <Link className="module-link" href="/billing"><article><span>09</span><h2>Billing</h2><p>Invoices, balances and partial or split payment allocations.</p></article></Link>}
          {permissions.has("specimens.view") && <Link className="module-link" href="/specimens"><article><span>10</span><h2>Specimens</h2><p>Barcode collection, receipt, rejection, recollection and custody traceability.</p></article></Link>}
          {permissions.has("transfers.view") && <Link className="module-link" href="/transfers"><article><span>11</span><h2>Transfers</h2><p>Inter-branch shipment manifests and barcode-by-barcode receiving.</p></article></Link>}
          {permissions.has("worklists.view") && <Link className="module-link" href="/worklists"><article><span>12</span><h2>Worklists</h2><p>Received specimens, manual result entry, reference flags and verification.</p></article></Link>}
        </div>
      </section>
    </main>
  );
}
