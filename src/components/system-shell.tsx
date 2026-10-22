"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { LogoutButton } from "@/components/logout-button";
import { SystemClock } from "@/components/system-clock";
import { SystemIcon, type SystemIconName } from "@/components/system-icon";
import { ThemeToggle } from "@/components/theme-toggle";

type BranchOption = { id: string; code: string; name: string };
type ShellUser = {
  displayName: string;
  organizationName: string;
  preferredLocale: string;
  activeBranchId: string | null;
  branches: BranchOption[];
  permissions: string[];
  avatarDataUrl: string | null;
};
type ShellAppearance = {
  systemName: string;
  logoDataUrl: string | null;
  defaultTheme: "LIGHT" | "DARK" | "SYSTEM";
  timezone: string;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD" | "DD MMM YYYY";
  timeFormat: "12" | "24";
  showSeconds: boolean;
  developerCredit: string;
  appVersion: string;
};

type NavItem = {
  href: string;
  labelEn: string;
  labelAr: string;
  icon: SystemIconName;
  permission?: string;
  permissionsAny?: string[];
  permissionsAll?: string[];
};

const groups: Array<{ labelEn: string; labelAr: string; items: NavItem[] }> = [
  {
    labelEn: "Reception",
    labelAr: "الاستقبال",
    items: [
      { href: "/dashboard", labelEn: "Dashboard", labelAr: "لوحة التحكم", icon: "dashboard" },
      { href: "/patients", labelEn: "Patients", labelAr: "المرضى", icon: "patients", permission: "patients.view" },
      { href: "/orders", labelEn: "Orders", labelAr: "الطلبات", icon: "orders", permission: "orders.view" },
      { href: "/billing", labelEn: "Billing", labelAr: "الفوترة", icon: "billing", permission: "billing.view" },
      { href: "/digital-services", labelEn: "Digital Services", labelAr: "الخدمات الرقمية", icon: "digital", permissionsAny: ["appointments.view","appointments.manage","home_collection.view","home_collection.manage","queue.view","queue.manage","portal_accounts.manage"] },
      { href: "/home-collections", labelEn: "Home Collections", labelAr: "الزيارات والسحب المنزلي", icon: "specimen", permissionsAny: ["home_collection.view","home_collection.manage","specimens.collect","specimens.receive"] },
    ],
  },
  {
    labelEn: "Laboratory",
    labelAr: "المختبر",
    items: [
      { href: "/phlebotomy", labelEn: "Phlebotomy", labelAr: "سحب العينات", icon: "specimen", permission: "specimens.collect" },
      { href: "/specimens", labelEn: "Specimens", labelAr: "العينات", icon: "specimen", permission: "specimens.view" },
      { href: "/transfers", labelEn: "Transfers", labelAr: "النقل بين الفروع", icon: "transfer", permission: "transfers.view" },
      { href: "/worklists", labelEn: "Worklists", labelAr: "قوائم العمل", icon: "worklist", permission: "worklists.view" },
      { href: "/reports", labelEn: "Reports", labelAr: "التقارير", icon: "report", permission: "reports.view" },
      { href: "/critical-results", labelEn: "Critical Results", labelAr: "النتائج الحرجة", icon: "critical", permission: "critical.communicate" },
      { href: "/microbiology", labelEn: "Microbiology", labelAr: "الأحياء الدقيقة", icon: "microbiology", permission: "microbiology.view" },
      { href: "/send-outs", labelEn: "Send-out Labs", labelAr: "المختبرات المرجعية", icon: "sendout", permission: "sendouts.view" },
    ],
  },
  {
    labelEn: "Configuration",
    labelAr: "الإعدادات المخبرية",
    items: [
      { href: "/catalog", labelEn: "Test Catalog", labelAr: "دليل الفحوصات", icon: "catalog", permission: "catalog.view" },
      { href: "/pricing", labelEn: "Pricing", labelAr: "الأسعار", icon: "pricing", permission: "pricing.view" },
      { href: "/report-templates", labelEn: "Report Templates", labelAr: "قوالب التقارير", icon: "template", permission: "report_templates.view" },
      { href: "/referrers", labelEn: "Referrers & Clients", labelAr: "المحيلون والعملاء", icon: "referrer", permission: "referrers.view" },
      { href: "/clinical-rules", labelEn: "Clinical Rules", labelAr: "القواعد السريرية", icon: "clinical", permission: "clinical_rules.manage" },
      { href: "/clinical-comments/review", labelEn: "Comment Approvals", labelAr: "اعتماد التعليقات السريرية", icon: "clinical", permissionsAll: ["clinical_rules.approve", "result_comments.manage"] },
      { href: "/clinical-comments/revisions", labelEn: "Comment Revisions", labelAr: "تصحيح التعليقات السريرية", icon: "template", permission: "result_comments.manage" },
      { href: "/analyzers", labelEn: "Analyzers", labelAr: "أجهزة التحليل", icon: "analyzer", permission: "analyzers.view" },
      { href: "/integrations", labelEn: "Integrations", labelAr: "التكاملات", icon: "integration", permission: "integrations.view" },
    ],
  },
  {
    labelEn: "Operations",
    labelAr: "العمليات",
    items: [
      { href: "/inventory", labelEn: "Inventory", labelAr: "المخزون", icon: "inventory", permission: "inventory.view" },
      { href: "/inventory/recall-quality", labelEn: "Recall Quality Follow-up", labelAr: "متابعة جودة الاستدعاءات", icon: "quality", permissionsAll: ["inventory.view", "quality.nonconformance.manage"] },
      { href: "/equipment", labelEn: "Equipment", labelAr: "المعدات", icon: "equipment", permission: "equipment.view" },
      { href: "/qc", labelEn: "Quality Control", labelAr: "ضبط الجودة", icon: "qc", permission: "qc.view" },
      { href: "/quality/eqa", labelEn: "External Quality / EQA", labelAr: "الكفاءة الخارجية EQA", icon: "qc", permission: "qc.view" },
      { href: "/quality", labelEn: "Quality Management", labelAr: "إدارة الجودة", icon: "quality", permission: "quality.view" },
      { href: "/analytics", labelEn: "Analytics", labelAr: "التحليلات", icon: "analytics", permission: "analytics.view" },
      { href: "/notifications", labelEn: "Notifications", labelAr: "الإشعارات", icon: "notification", permission: "notifications.view" },
      { href: "/resilience", labelEn: "Resilience", labelAr: "الاستمرارية والتعافي", icon: "resilience", permission: "resilience.view" },
    ],
  },
  {
    labelEn: "Administration",
    labelAr: "الإدارة",
    items: [
      { href: "/organization/branches", labelEn: "Branches & Departments", labelAr: "الفروع والأقسام", icon: "settings", permissionsAny: ["branches.view", "branches.manage"] },
      { href: "/settings", labelEn: "System Settings", labelAr: "إعدادات النظام", icon: "settings", permission: "settings.manage" },
      { href: "/users", labelEn: "Users", labelAr: "المستخدمون", icon: "users", permission: "users.view" },
      { href: "/roles", labelEn: "Roles & Permissions", labelAr: "الأدوار والصلاحيات", icon: "roles", permission: "roles.view" },
      { href: "/security", labelEn: "Security", labelAr: "الأمان", icon: "security" },
    ],
  },
];

const publicPrefixes = ["/login", "/setup", "/portal", "/queue-display", "/verify"];

export function SystemShell({ user, appearance, children }: { user: ShellUser; appearance: ShellAppearance; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [branchBusy, setBranchBusy] = useState(false);
  const [localeBusy, setLocaleBusy] = useState(false);
  const permissionSet = useMemo(() => new Set(user.permissions), [user.permissions]);

  if (publicPrefixes.some(prefix => pathname === prefix || pathname.startsWith(prefix + "/"))) return <>{children}</>;

  const visibleGroups = groups.map(group => ({
    ...group,
    items: group.items.filter(item => {
      if (item.permission && !permissionSet.has(item.permission)) return false;
      if (item.permissionsAny && !item.permissionsAny.some(code => permissionSet.has(code))) return false;
      if (item.permissionsAll && !item.permissionsAll.every(code => permissionSet.has(code))) return false;
      return true;
    }),
  })).filter(group => group.items.length > 0);

  async function switchBranch(branchId: string) {
    if (!branchId || branchId === user.activeBranchId) return;
    setBranchBusy(true);
    const response = await fetch("/api/session/active-branch", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branchId }),
    });
    setBranchBusy(false);
    if (response.ok) router.refresh();
  }

  async function switchLocale() {
    const nextLocale = user.preferredLocale === "ar" ? "en" : "ar";
    setLocaleBusy(true);
    const response = await fetch("/api/session/locale", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: nextLocale }),
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
        {appearance.logoDataUrl
          ? <div className="system-brand-logo"><Image src={appearance.logoDataUrl} alt={appearance.systemName} width={46} height={46} unoptimized /></div>
          : <div className="system-brand-mark">FL</div>}
        <div><strong>{appearance.systemName}</strong><span>{tr("Laboratory Information System", "نظام معلومات المختبر")}</span></div>
      </div>

      <nav className="system-nav" aria-label={tr("Primary navigation", "التنقل الرئيسي")}>
        {visibleGroups.map(group => <div className="system-nav-group" key={group.labelEn}>
          <p>{tr(group.labelEn, group.labelAr)}</p>
          {group.items.map(item => {
            const active = item.href === "/dashboard" ? pathname === "/dashboard" : pathname === item.href || pathname.startsWith(item.href + "/");
            return <Link key={item.href} href={item.href} className={"system-nav-link" + (active ? " active" : "")} onClick={() => setMobileOpen(false)}>
              <span className="system-nav-icon"><SystemIcon name={item.icon} size={17} /></span>
              <span>{tr(item.labelEn, item.labelAr)}</span>
            </Link>;
          })}
        </div>)}
      </nav>

      <div className="system-sidebar-footer">
        <span>{user.organizationName}</span>
        <small>{activeBranch ? activeBranch.code + " · " + activeBranch.name : tr("No active branch", "لا يوجد فرع نشط")}</small>
        <div className="system-credit">
          <small>{tr("Designed & developed by", "تصميم وتطوير")} {appearance.developerCredit}</small>
          <small>v{appearance.appVersion}</small>
        </div>
      </div>
    </aside>

    {mobileOpen && <button className="system-sidebar-backdrop" aria-label={tr("Close navigation", "إغلاق القائمة")} onClick={() => setMobileOpen(false)} />}

    <div className="system-main">
      <header className="system-topbar">
        <button className="system-mobile-menu" type="button" onClick={() => setMobileOpen(value => !value)} aria-label={tr("Toggle navigation", "فتح القائمة")}><SystemIcon name="menu" /></button>
        <div className="system-page-context">
          <span className="system-context-dot" />
          <div><small>{tr("Active workspace", "مساحة العمل الحالية")}</small><strong>{activeBranch?.name || tr("Organization", "المؤسسة")}</strong></div>
        </div>
        <form className="system-global-search" action="/search" method="get">
          <SystemIcon name="search" size={16} />
          <input name="q" placeholder={tr("Search patient, accession, barcode…", "ابحث عن مريض، طلب، باركود…")} aria-label={tr("Global search", "البحث الشامل")} />
        </form>
        <div className="system-topbar-actions">
          <SystemClock locale={locale} timezone={appearance.timezone} dateFormat={appearance.dateFormat} timeFormat={appearance.timeFormat} showSeconds={appearance.showSeconds} />
          {user.branches.length > 1 && <label className="system-branch-select">
            <span>{tr("Branch", "الفرع")}</span>
            <select value={user.activeBranchId || ""} disabled={branchBusy} onChange={event => void switchBranch(event.target.value)}>
              {user.branches.map(branch => <option value={branch.id} key={branch.id}>{branch.code} — {branch.name}</option>)}
            </select>
          </label>}
          <ThemeToggle defaultTheme={appearance.defaultTheme} labelLight={tr("Switch to light mode", "التبديل للوضع الفاتح")} labelDark={tr("Switch to dark mode", "التبديل للوضع الداكن")} />
          <button className="system-locale-toggle" type="button" disabled={localeBusy} onClick={() => void switchLocale()}>{localeBusy ? "…" : locale === "ar" ? "EN" : "AR"}</button>
          <div className="system-user">
            <span className="system-avatar">
              {user.avatarDataUrl
                ? <Image src={user.avatarDataUrl} alt={user.displayName} width={34} height={34} unoptimized />
                : <SystemIcon name="users" size={18} />}
            </span>
            <div><strong>{user.displayName}</strong><small>{locale === "ar" ? "العربية" : "English"}</small></div>
          </div>
          <LogoutButton label={tr("Sign out", "تسجيل الخروج")} locale={locale} />
        </div>
      </header>
      <div className="system-content">{children}</div>
    </div>
  </div>;
}
