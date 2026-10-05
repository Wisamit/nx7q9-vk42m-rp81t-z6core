"use client";

import { FormEvent, useEffect, useState } from "react";
import { SystemIcon } from "@/components/system-icon";

type Role = { id: string; code: string; nameEn: string; nameAr: string | null; isSystem: boolean };
type Branch = { id: string; code: string; nameEn: string; nameAr: string | null };
type UserRow = {
  id: string; username: string; email: string | null; displayNameEn: string; displayNameAr: string | null;
  preferredLocale: string; status: string; mfaEnabled: boolean; lastLoginAt: string | null;
  roleIds: string[]; roleNames: string[]; branchIds: string[]; branchNames: string[];
};
type Data = { users: UserRow[]; roles: Role[]; branches: Branch[] };

export function UserManagement({ locale }: { locale: "ar" | "en" }) {
  const [data, setData] = useState<Data>({ users: [], roles: [], branches: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function load() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const body = await response.json();
    if (response.ok) setData(body);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/users", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        email: form.get("email"),
        displayNameEn: form.get("displayNameEn"),
        displayNameAr: form.get("displayNameAr"),
        password: form.get("password"),
        preferredLocale: form.get("preferredLocale"),
        roleIds: form.getAll("roleIds"),
        branchIds: form.getAll("branchIds"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      event.currentTarget.reset();
      setMessage(tr("User created successfully.", "تم إنشاء المستخدم بنجاح."));
      await load();
    } else {
      setMessage(body.error === "invalid_scope" ? tr("Select valid roles and branches.", "اختر أدوارًا وفروعًا صحيحة.") : tr("Unable to create user. Username may already exist.", "تعذر إنشاء المستخدم. قد يكون اسم المستخدم مستخدمًا."));
    }
    setBusy(false);
  }

  async function setStatus(user: UserRow, status: "ACTIVE" | "SUSPENDED") {
    setBusy(true); setMessage("");
    const response = await fetch("/api/admin/users/" + user.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(body.error === "last_system_admin" ? tr("The last system administrator cannot be disabled.", "لا يمكن تعطيل آخر مدير للنظام.") : tr("Unable to update user.", "تعذر تحديث المستخدم."));
    await load();
    setBusy(false);
  }

  return <div className="admin-grid">
    <section className="settings-card">
      <div className="settings-card-title"><SystemIcon name="users" /><div><h2>{tr("Create staff user", "إنشاء مستخدم موظف")}</h2><p>{tr("Assign roles and explicit branch scopes at creation.", "حدد الأدوار والفروع المسموح بها عند الإنشاء.")}</p></div></div>
      <form className="settings-grid" onSubmit={createUser}>
        <label>{tr("English display name", "الاسم بالإنجليزية")}<input name="displayNameEn" required /></label>
        <label>{tr("Arabic display name", "الاسم بالعربية")}<input name="displayNameAr" /></label>
        <label>{tr("Username", "اسم المستخدم")}<input name="username" required minLength={3} autoCapitalize="none" /></label>
        <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" /></label>
        <label>{tr("Temporary password", "كلمة المرور المؤقتة")}<input name="password" type="password" required minLength={12} autoComplete="new-password" /><small>{tr("Minimum 12 characters.", "12 محرفًا على الأقل.")}</small></label>
        <label>{tr("Preferred language", "اللغة المفضلة")}<select name="preferredLocale" defaultValue="en"><option value="en">English</option><option value="ar">العربية</option></select></label>
        <fieldset className="admin-checklist"><legend>{tr("Roles", "الأدوار")}</legend>{data.roles.map(role => <label key={role.id}><input type="checkbox" name="roleIds" value={role.id} />{locale === "ar" ? role.nameAr || role.nameEn : role.nameEn}</label>)}</fieldset>
        <fieldset className="admin-checklist"><legend>{tr("Branch access", "صلاحية الفروع")}</legend>{data.branches.map(branch => <label key={branch.id}><input type="checkbox" name="branchIds" value={branch.id} />{branch.code} — {locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn}</label>)}</fieldset>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create user", "إنشاء المستخدم")}</button>
      </form>
      {message && <p className="form-success">{message}</p>}
    </section>

    <section className="table-card admin-table-card">
      <div className="table-toolbar"><div><h2>{tr("Staff users", "المستخدمون")}</h2><span>{tr("Roles, branches, MFA and account state", "الأدوار والفروع وMFA وحالة الحساب")}</span></div><span>{data.users.length}</span></div>
      <div className="table-wrap">{loading ? <div className="empty-state">{tr("Loading…", "جارٍ التحميل…")}</div> : <table><thead><tr><th>{tr("User", "المستخدم")}</th><th>{tr("Roles", "الأدوار")}</th><th>{tr("Branches", "الفروع")}</th><th>MFA</th><th>{tr("Status", "الحالة")}</th><th>{tr("Actions", "إجراءات")}</th></tr></thead>
      <tbody>{data.users.map(user => <tr key={user.id}><td><strong>{locale === "ar" ? user.displayNameAr || user.displayNameEn : user.displayNameEn}</strong><small className="table-subtext">@{user.username}{user.email ? " · " + user.email : ""}</small></td><td>{user.roleNames.join(", ") || "—"}</td><td>{user.branchNames.join(", ") || "—"}</td><td><span className={"status-badge " + (user.mfaEnabled ? "status-active" : "status-draft")}>{user.mfaEnabled ? "ON" : "OFF"}</span></td><td><span className={"status-badge " + (user.status === "ACTIVE" ? "status-active" : "status-warning")}>{user.status}</span></td><td>{user.status === "ACTIVE" ? <button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => void setStatus(user, "SUSPENDED")}>{tr("Suspend", "تعليق")}</button> : <button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => void setStatus(user, "ACTIVE")}>{tr("Activate", "تفعيل")}</button>}</td></tr>)}</tbody></table>}</div>
    </section>
  </div>;
}
