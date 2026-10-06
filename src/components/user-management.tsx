"use client";

import { FormEvent, useEffect, useState } from "react";
import { SystemIcon } from "@/components/system-icon";
import { CrudModal } from "@/components/crud-modal";
import { statusLabel } from "@/lib/ui-i18n";

type Role = { id: string; code: string; nameEn: string; nameAr: string | null; isSystem: boolean };
type Branch = { id: string; code: string; nameEn: string; nameAr: string | null };
type Department = { id: string; code: string; nameEn: string; nameAr: string | null; branchId: string | null };
type UserRow = {
  id: string; username: string; email: string | null; displayNameEn: string; displayNameAr: string | null;
  preferredLocale: string; status: string; mfaEnabled: boolean; lastLoginAt: string | null;
  roleIds: string[]; roleNames: string[]; branchIds: string[]; branchNames: string[]; departmentIds: string[]; departmentNames: string[];
};
type Data = { users: UserRow[]; roles: Role[]; branches: Branch[]; departments: Department[] };

export function UserManagement({ locale }: { locale: "ar" | "en" }) {
  const [data, setData] = useState<Data>({ users: [], roles: [], branches: [], departments: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  function localizedRoleNames(user: UserRow) {
    return user.roleIds.map((id, index) => {
      const role = data.roles.find(item => item.id === id);
      return role ? (locale === "ar" ? role.nameAr || role.nameEn : role.nameEn) : user.roleNames[index] || id;
    }).join(", ") || "—";
  }

  function localizedBranchNames(user: UserRow) {
    return user.branchIds.map((id, index) => {
      const branch = data.branches.find(item => item.id === id);
      return branch ? (locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn) : user.branchNames[index] || id;
    }).join(", ") || "—";
  }

  function localizedDepartmentNames(user: UserRow) {
    if (user.departmentIds.length === 0) return tr("All departments", "كل الأقسام");
    return user.departmentIds.map((id, index) => {
      const department = data.departments.find(item => item.id === id);
      return department ? (locale === "ar" ? department.nameAr || department.nameEn : department.nameEn) : user.departmentNames[index] || id;
    }).join(", ");
  }

  async function load() {
    const response = await fetch("/api/admin/users", { cache: "no-store" });
    const body = await response.json();
    if (response.ok) setData(body);
    setLoading(false);
  }
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/users", { cache: "no-store" })
      .then(async response => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (cancelled) return;
        if (response.ok) setData(body);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

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
        departmentIds: form.getAll("departmentIds"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      event.currentTarget.reset();
      setMessage(tr("User created successfully.", "تم إنشاء المستخدم بنجاح."));
      setCreateOpen(false);
      await load();
    } else {
      setMessage(body.error === "invalid_scope" ? tr("Select valid roles and branches.", "اختر أدوارًا وفروعًا صحيحة.") : tr("Unable to create user. Username may already exist.", "تعذر إنشاء المستخدم. قد يكون اسم المستخدم مستخدمًا."));
    }
    setBusy(false);
  }

  async function updateAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/users/" + editing.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roleIds: form.getAll("roleIds"),
        branchIds: form.getAll("branchIds"),
        departmentIds: form.getAll("departmentIds"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setEditing(null);
      setMessage(tr("Access updated successfully.", "تم تحديث صلاحيات الوصول بنجاح."));
      await load();
    } else {
      setMessage(body.error === "invalid_scope"
        ? tr("Department access must match the selected branches.", "يجب أن تتوافق صلاحيات الأقسام مع الفروع المحددة.")
        : tr("Unable to update access.", "تعذر تحديث صلاحيات الوصول."));
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
    <div className="admin-page-actions">
      {message && <span className="crud-success-toast">{message}</span>}
      <button type="button" className="primary-button" onClick={() => { setMessage(""); setCreateOpen(true); }}>
        <SystemIcon name="plus" size={16} />{tr("Add User", "إضافة مستخدم")}
      </button>
    </div>

    <CrudModal
      open={createOpen}
      onClose={() => setCreateOpen(false)}
      title={tr("Create staff user", "إنشاء مستخدم موظف")}
      description={tr("Assign role-based permissions and explicit branch access.", "حدد الدور والصلاحيات والفروع المسموح بها.")}
      size="lg"
    >
      <form className="settings-grid" onSubmit={createUser}>
        <label>{tr("English display name", "الاسم بالإنجليزية")}<input name="displayNameEn" required /></label>
        <label>{tr("Arabic display name", "الاسم بالعربية")}<input name="displayNameAr" /></label>
        <label>{tr("Username", "اسم المستخدم")}<input name="username" required minLength={3} autoCapitalize="none" /></label>
        <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" /></label>
        <label>{tr("Temporary password", "كلمة المرور المؤقتة")}<input name="password" type="password" required minLength={12} autoComplete="new-password" /><small>{tr("Minimum 12 characters.", "12 محرفًا على الأقل.")}</small></label>
        <label>{tr("Preferred language", "اللغة المفضلة")}<select name="preferredLocale" defaultValue="en"><option value="en">{tr("English", "الإنجليزية")}</option><option value="ar">العربية</option></select></label>
        <fieldset className="admin-checklist"><legend>{tr("Roles", "الأدوار")}</legend>{data.roles.map(role => <label key={role.id}><input type="checkbox" name="roleIds" value={role.id} />{locale === "ar" ? role.nameAr || role.nameEn : role.nameEn}</label>)}</fieldset>
        <fieldset className="admin-checklist"><legend>{tr("Branch access", "صلاحية الفروع")}</legend>{data.branches.map(branch => <label key={branch.id}><input type="checkbox" name="branchIds" value={branch.id} />{branch.code} — {locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn}</label>)}</fieldset>
        <fieldset className="admin-checklist form-span"><legend>{tr("Department access", "صلاحية الأقسام")}</legend><small>{tr("Optional: no selection means all departments within the selected branches. Selecting departments restricts clinical access.", "اختياري: عدم التحديد يعني كل الأقسام ضمن الفروع المختارة. تحديد أقسام يقيّد الوصول السريري بها.")}</small>{data.departments.map(department => <label key={department.id}><input type="checkbox" name="departmentIds" value={department.id} />{department.code} — {locale === "ar" ? department.nameAr || department.nameEn : department.nameEn}</label>)}</fieldset>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create user", "إنشاء المستخدم")}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>

    <CrudModal
      open={Boolean(editing)}
      onClose={() => setEditing(null)}
      title={tr("Edit access", "تعديل صلاحيات الوصول")}
      description={editing ? editing.displayNameEn + " · @" + editing.username : undefined}
      size="lg"
    >
      {editing && <form className="settings-grid" onSubmit={updateAccess}>
        <fieldset className="admin-checklist"><legend>{tr("Roles", "الأدوار")}</legend>{data.roles.map(role => <label key={role.id}><input type="checkbox" name="roleIds" value={role.id} defaultChecked={editing.roleIds.includes(role.id)} />{locale === "ar" ? role.nameAr || role.nameEn : role.nameEn}</label>)}</fieldset>
        <fieldset className="admin-checklist"><legend>{tr("Branch access", "صلاحية الفروع")}</legend>{data.branches.map(branch => <label key={branch.id}><input type="checkbox" name="branchIds" value={branch.id} defaultChecked={editing.branchIds.includes(branch.id)} />{branch.code} — {locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn}</label>)}</fieldset>
        <fieldset className="admin-checklist form-span"><legend>{tr("Department access", "صلاحية الأقسام")}</legend><small>{tr("No department selection means unrestricted department access inside the selected branches.", "عدم تحديد أقسام يعني السماح بكل الأقسام ضمن الفروع المحددة.")}</small>{data.departments.map(department => <label key={department.id}><input type="checkbox" name="departmentIds" value={department.id} defaultChecked={editing.departmentIds.includes(department.id)} />{department.code} — {locale === "ar" ? department.nameAr || department.nameEn : department.nameEn}</label>)}</fieldset>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Save access", "حفظ الصلاحيات")}</button>
      </form>}
    </CrudModal>

    <section className="table-card admin-table-card">
      <div className="table-toolbar"><div><h2>{tr("Staff users", "المستخدمون")}</h2><span>{tr("Roles, branches, MFA and account state", "الأدوار والفروع وMFA وحالة الحساب")}</span></div><span>{data.users.length}</span></div>
      <div className="table-wrap">{loading ? <div className="empty-state">{tr("Loading…", "جارٍ التحميل…")}</div> : <table><thead><tr><th>{tr("User", "المستخدم")}</th><th>{tr("Roles", "الأدوار")}</th><th>{tr("Branches", "الفروع")}</th><th>{tr("Departments", "الأقسام")}</th><th>{tr("MFA", "المصادقة متعددة العوامل")}</th><th>{tr("Status", "الحالة")}</th><th>{tr("Actions", "إجراءات")}</th></tr></thead>
      <tbody>{data.users.map(user => <tr key={user.id}><td><strong>{locale === "ar" ? user.displayNameAr || user.displayNameEn : user.displayNameEn}</strong><small className="table-subtext">@{user.username}{user.email ? " · " + user.email : ""}</small></td><td>{localizedRoleNames(user)}</td><td>{localizedBranchNames(user)}</td><td>{localizedDepartmentNames(user)}</td><td><span className={"status-badge " + (user.mfaEnabled ? "status-active" : "status-draft")}>{user.mfaEnabled ? tr("ON", "مفعلة") : tr("OFF", "غير مفعلة")}</span></td><td><span className={"status-badge " + (user.status === "ACTIVE" ? "status-active" : "status-warning")}>{statusLabel(locale, user.status)}</span></td><td><div className="inline-actions">
  <button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => setEditing(user)}>{tr("Edit access", "تعديل الصلاحيات")}</button>
  {user.status === "ACTIVE" ? <button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => void setStatus(user, "SUSPENDED")}>{tr("Suspend", "تعليق")}</button> : <button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => void setStatus(user, "ACTIVE")}>{tr("Activate", "تفعيل")}</button>}
</div></td></tr>)}</tbody></table>}</div>
    </section>
  </div>;
}
