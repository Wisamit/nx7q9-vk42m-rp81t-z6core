"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { LogoutButton } from "@/components/logout-button";

type BranchOption = { id: string; code: string; name: string };
type ShellUser = {
  displayName: string;
  organizationName: string;
  preferredLocale: string;
  activeBranchId: string | null;
  branches: BranchOption[];
  permissions: string[];
};

type NavItem = {
  href: string;
  label: string;
  short: string;
  permission?: string;
  permissionsAny?: string[];
};

const groups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Reception",
    items: [
      { href: "/dashboard", label: "Dashboard", short: "DB" },
      { href: "/patients", label: "Patients", short: "PT", permission: "patients.view" },
      { href: "/orders", label: "Orders", short: "OR", permission: "orders.view" },
      { href: "/billing", label: "Billing", short: "BI", permission: "billing.view" },
      { href: "/digital-services", label: "Digital Services", short: "DS", permissionsAny: ["appointments.view","appointments.manage","home_collection.view","home_collection.manage","queue.view","queue.manage","portal_accounts.manage"] },
    ],
  },
  {
    label: "Laboratory",
    items: [
      { href: "/specimens", label: "Specimens", short: "SP", permission: "specimens.view" },
      { href: "/transfers", label: "Transfers", short: "TR", permission: "transfers.view" },
      { href: "/worklists", label: "Worklists", short: "WL", permission: "worklists.view" },
      { href: "/reports", label: "Reports", short: "RP", permission: "reports.view" },
      { href: "/critical-results", label: "Critical Results", short: "CR", permission: "critical.communicate" },
      { href: "/microbiology", label: "Microbiology", short: "MB", permission: "microbiology.view" },
    ],
  },
  {
    label: "Configuration",
    items: [
      { href: "/catalog", label: "Test Catalog", short: "TC", permission: "catalog.view" },
      { href: "/pricing", label: "Pricing", short: "PR", permission: "pricing.view" },
      { href: "/referrers", label: "Referrers & Clients", short: "RC", permission: "referrers.view" },
      { href: "/clinical-rules", label: "Clinical Rules", short: "CL", permission: "clinical_rules.manage" },
      { href: "/analyzers", label: "Analyzers", short: "AN", permission: "analyzers.view" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/inventory", label: "Inventory", short: "IN", permission: "inventory.view" },
      { href: "/equipment", label: "Equipment", short: "EQ", permission: "equipment.view" },
      { href: "/qc", label: "Quality Control", short: "QC", permission: "qc.view" },
      { href: "/quality", label: "Quality Management", short: "QM", permission: "quality.view" },
      { href: "/analytics", label: "Analytics", short: "AI", permission: "analytics.view" },
    ],
  },
];

const publicPrefixes = ["/login", "/setup", "/portal", "/queue-display", "/verify"];

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "FL";
}

export function SystemShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [branchBusy, setBranchBusy] = useState(false);
  const permissionSet = useMemo(() => new Set(user.permissions), [user.permissions]);

  if (publicPrefixes.some(prefix => pathname === prefix || pathname.startsWith(prefix + "/"))) {
    return <>{children}</>;
  }

  const visibleGroups = groups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (item.permission && !permissionSet.has(item.permission)) return false;
      if (item.permissionsAny && !item.permissionsAny.some(code => permissionSet.has(code))) return false;
      return true;
    }),
  })).filter(group => group.items.length > 0);

  async function switchBranch(branchId: string) {
    if (!branchId || branchId === user.activeBranchId) return;
    setBranchBusy(true);
    const response = await fetch("/api/session/active-branch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchId }),
    });
    setBranchBusy(false);
    if (response.ok) router.refresh();
  }

  const locale = user.preferredLocale === "ar" ? "ar" : "en";
  const activeBranch = user.branches.find(branch => branch.id === user.activeBranchId) || null;

  return <div className="system-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <aside className={"system-sidebar" + (mobileOpen ? " open" : "")}>
      <div className="system-brand">
        <div className="system-brand-mark">FL</div>
        <div><strong>Family Lab</strong><span>Laboratory Information System</span></div>
      </div>

      <nav className="system-nav" aria-label="Primary navigation">
        {visibleGroups.map(group => <div className="system-nav-group" key={group.label}>
          <p>{group.label}</p>
          {group.items.map(item => {
            const active = item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname === item.href || pathname.startsWith(item.href + "/");
            return <Link
              key={item.href}
              href={item.href}
              className={"system-nav-link" + (active ? " active" : "")}
              onClick={() => setMobileOpen(false)}
            >
              <span className="system-nav-icon">{item.short}</span>
              <span>{item.label}</span>
            </Link>;
          })}
        </div>)}
      </nav>

      <div className="system-sidebar-footer">
        <span>{user.organizationName}</span>
        <small>{activeBranch ? activeBranch.code + " · " + activeBranch.name : "No active branch"}</small>
      </div>
    </aside>

    {mobileOpen && <button className="system-sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

    <div className="system-main">
      <header className="system-topbar">
        <button className="system-mobile-menu" type="button" onClick={() => setMobileOpen(value => !value)} aria-label="Toggle navigation">☰</button>
        <div className="system-page-context">
          <span className="system-context-dot" />
          <div><small>Active workspace</small><strong>{activeBranch?.name || "Organization"}</strong></div>
        </div>
        <div className="system-topbar-actions">
          {user.branches.length > 1 && <label className="system-branch-select">
            <span>Branch</span>
            <select value={user.activeBranchId || ""} disabled={branchBusy} onChange={event => void switchBranch(event.target.value)}>
              {user.branches.map(branch => <option value={branch.id} key={branch.id}>{branch.code} — {branch.name}</option>)}
            </select>
          </label>}
          <div className="system-user">
            <span className="system-avatar">{initials(user.displayName)}</span>
            <div><strong>{user.displayName}</strong><small>{locale === "ar" ? "العربية" : "English"}</small></div>
          </div>
          <LogoutButton />
        </div>
      </header>

      <div className="system-content">{children}</div>
    </div>
  </div>;
}
