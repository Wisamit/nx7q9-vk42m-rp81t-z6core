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
          <article className="coming"><span>04</span><h2>Test Catalog</h2><p>Next phase: configuration-driven Test Catalog.</p></article>
        </div>
      </section>
    </main>
  );
}
