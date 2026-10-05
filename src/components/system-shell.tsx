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
  labelEn: string;
  labelAr: string;
  short: string;
  permission?: string;
  permissionsAny?: string[];
};

const groups: Array<{ labelEn: string; labelAr: string; items: NavItem[] }> = [
  {
    labelEn: "Reception",
    labelAr: "الاستقبال",
    items: [
      { href: "/dashboard", labelEn: "Dashboard", labelAr: "لوحة التحكم", short: "DB" },
      { href: "/patients", labelEn: "Patients", labelAr: "المرضى", short: "PT", permission: "patients.view" },
      { href: "/orders", labelEn: "Orders", labelAr: "الطلبات", short: "OR", permission: "orders.view" },
      { href: "/billing", labelEn: "Billing", labelAr: "الفوترة", short: "BI", permission: "billing.view" },
      { href: "/digital-services", labelEn: "Digital Services", labelAr: "الخدمات الرقمية", short: "DS", permissionsAny: ["appointments.view","appointments.manage","home_collection.view","home_collection.manage","queue.view","queue.manage","portal_accounts.manage"] },
    ],
  },
  {
    labelEn: "Laboratory",
    labelAr: "المختبر",
    items: [
      { href: "/specimens", labelEn: "Specimens", labelAr: "العينات", short: "SP", permission: "specimens.view" },
      { href: "/transfers", labelEn: "Transfers", labelAr: "النقل بين الفروع", short: "TR", permission: "transfers.view" },
      { href: "/worklists", labelEn: "Worklists", labelAr: "قوائم العمل", short: "WL", permission: "worklists.view" },
      { href: "/reports", labelEn: "Reports", labelAr: "التقارير", short: "RP", permission: "reports.view" },
      { href: "/critical-results", labelEn: "Critical Results", labelAr: "النتائج الحرجة", short: "CR", permission: "critical.communicate" },
      { href: "/microbiology", labelEn: "Microbiology", labelAr: "الأحياء الدقيقة", short: "MB", permission: "microbiology.view" },
    ],
  },
  {
    labelEn: "Configuration",
    labelAr: "الإعدادات",
    items: [
      { href: "/catalog", labelEn: "Test Catalog", labelAr: "دليل الفحوصات", short: "TC", permission: "catalog.view" },
      { href: "/pricing", labelEn: "Pricing", labelAr: "الأسعار", short: "PR", permission: "pricing.view" },
      { href: "/referrers", labelEn: "Referrers & Clients", labelAr: "المحيلون والعملاء", short: "RC", permission: "referrers.view" },
      { href: "/clinical-rules", labelEn: "Clinical Rules", labelAr: "القواعد السريرية", short: "CL", permission: "clinical_rules.manage" },
      { href: "/analyzers", labelEn: "Analyzers", labelAr: "أجهزة التحليل", short: "AN", permission: "analyzers.view" },
      { href: "/integrations", labelEn: "Integrations", labelAr: "التكاملات", short: "IG", permission: "integrations.view" },
    ],
  },
  {
    labelEn: "Operations",
    labelAr: "العمليات",
    items: [
      { href: "/inventory", labelEn: "Inventory", labelAr: "المخزون", short: "IN", permission: "inventory.view" },
      { href: "/equipment", labelEn: "Equipment", labelAr: "المعدات", short: "EQ", permission: "equipment.view" },
      { href: "/qc", labelEn: "Quality Control", labelAr: "ضبط الجودة", short: "QC", permission: "qc.view" },
      { href: "/quality", labelEn: "Quality Management", labelAr: "إدارة الجودة", short: "QM", permission: "quality.view" },
      { href: "/analytics", labelEn: "Analytics", labelAr: "التحليلات", short: "AI", permission: "analytics.view" },
      { href: "/notifications", labelEn: "Notifications", labelAr: "الإشعارات", short: "NT", permission: "notifications.view" },
      { href: "/resilience", labelEn: "Resilience", labelAr: "الاستمرارية والتعافي", short: "RS", permission: "resilience.view" },
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
  const [localeBusy, setLocaleBusy] = useState(false);
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

  async function switchLocale() {
    const nextLocale = user.preferredLocale === "ar" ? "en" : "ar";
    setLocaleBusy(true);
    const response = await fetch("/api/session/locale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale: nextLocale }),
    });
    setLocaleBusy(false);
    if (response.ok) router.refresh();
  }

  const locale = user.preferredLocale === "ar" ? "ar" : "en";
  const activeBranch = user.branches.find(branch => branch.id === user.activeBranchId) || null;
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  return <div className="system-shell" dir={locale === "ar" ? "rtl" : "ltr"}>
    <aside className={"system-sidebar" + (mobileOpen ? " open" : "")}>
      <div className="system-brand">
        <div className="system-brand-mark">FL</div>
        <div><strong>Family Lab</strong><span>{tr("Laboratory Information System", "نظام معلومات المختبر")}</span></div>
      </div>

      <nav className="system-nav" aria-label={tr("Primary navigation", "التنقل الرئيسي")}>
        {visibleGroups.map(group => <div className="system-nav-group" key={group.labelEn}>
          <p>{tr(group.labelEn, group.labelAr)}</p>
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
              <span>{tr(item.labelEn, item.labelAr)}</span>
            </Link>;
          })}
        </div>)}
      </nav>

      <div className="system-sidebar-footer">
        <span>{user.organizationName}</span>
        <small>{activeBranch ? activeBranch.code + " · " + activeBranch.name : tr("No active branch", "لا يوجد فرع نشط")}</small>
      </div>
    </aside>

    {mobileOpen && <button className="system-sidebar-backdrop" aria-label={tr("Close navigation", "إغلاق القائمة")} onClick={() => setMobileOpen(false)} />}

    <div className="system-main">
      <header className="system-topbar">
        <button className="system-mobile-menu" type="button" onClick={() => setMobileOpen(value => !value)} aria-label={tr("Toggle navigation", "فتح القائمة")}>☰</button>
        <div className="system-page-context">
          <span className="system-context-dot" />
          <div><small>{tr("Active workspace", "مساحة العمل الحالية")}</small><strong>{activeBranch?.name || tr("Organization", "المؤسسة")}</strong></div>
        </div>
        <form className="system-global-search" action="/search" method="get">
          <span aria-hidden="true">⌕</span>
          <input name="q" placeholder={tr("Search patient, accession, barcode…", "ابحث عن مريض، طلب، باركود…")} aria-label={tr("Global search", "البحث الشامل")} />
        </form>
        <div className="system-topbar-actions">
          {user.branches.length > 1 && <label className="system-branch-select">
            <span>{tr("Branch", "الفرع")}</span>
            <select value={user.activeBranchId || ""} disabled={branchBusy} onChange={event => void switchBranch(event.target.value)}>
              {user.branches.map(branch => <option value={branch.id} key={branch.id}>{branch.code} — {branch.name}</option>)}
            </select>
          </label>}
          <button className="system-locale-toggle" type="button" disabled={localeBusy} onClick={() => void switchLocale()}>
            {localeBusy ? "…" : locale === "ar" ? "EN" : "AR"}
          </button>
          <div className="system-user">
            <span className="system-avatar">{initials(user.displayName)}</span>
            <div><strong>{user.displayName}</strong><small>{locale === "ar" ? "العربية" : "English"}</small></div>
          </div>
          <LogoutButton label={tr("Sign out", "تسجيل الخروج")} />
        </div>
      </header>

      <div className="system-content">{children}</div>
    </div>
  </div>;
}
