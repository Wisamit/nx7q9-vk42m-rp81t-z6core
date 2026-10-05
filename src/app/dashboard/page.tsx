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
          {permissions.has("reports.view") && <Link className="module-link" href="/reports"><article><span>13</span><h2>Reports</h2><p>Immutable partial, final and amended diagnostic report versions.</p></article></Link>}
          {permissions.has("clinical_rules.manage") && <Link className="module-link" href="/clinical-rules"><article><span>14</span><h2>Clinical Rules</h2><p>Calculated results, reflex, validation holds, autoverification, escalation and delta policies.</p></article></Link>}
          {permissions.has("critical.communicate") && <Link className="module-link" href="/critical-results"><article><span>15</span><h2>Critical Results</h2><p>Open critical values, acknowledgement deadlines and escalation tracking.</p></article></Link>}
          {permissions.has("microbiology.view") && <Link className="module-link" href="/microbiology"><article><span>16</span><h2>Microbiology</h2><p>Culture observations, organisms, isolates and antimicrobial susceptibility workflow.</p></article></Link>}
          {permissions.has("analyzers.view") && <Link className="module-link" href="/analyzers"><article><span>17</span><h2>Analyzers</h2><p>Analyzer registry, bridge credentials, mappings and raw interface message inbox.</p></article></Link>}
          {permissions.has("inventory.view") && <Link className="module-link" href="/inventory"><article><span>18</span><h2>Inventory</h2><p>Branch stock, lot and expiry traceability, FEFO, suppliers and procurement receiving.</p></article></Link>}
          {permissions.has("equipment.view") && <Link className="module-link" href="/equipment"><article><span>19</span><h2>Equipment</h2><p>Asset register, maintenance, calibration, downtime and analyzer linkage.</p></article></Link>}
          {permissions.has("qc.view") && <Link className="module-link" href="/qc"><article><span>20</span><h2>Quality Control</h2><p>QC materials, lots, Levey-Jennings trends, Westgard rules and analyzer QC gating.</p></article></Link>}
          {permissions.has("quality.view") && <Link className="module-link" href="/quality"><article><span>21</span><h2>Quality Management</h2><p>Nonconformance, CAPA, controlled documents, training, competency, indicators and internal audits.</p></article></Link>}
        </div>
      </section>
    </main>
  );
}
