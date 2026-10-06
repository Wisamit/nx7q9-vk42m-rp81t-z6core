"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { SystemIcon } from "@/components/system-icon";
import { CrudModal } from "@/components/crud-modal";
import { statusLabel } from "@/lib/ui-i18n";

type Permission = { id: string; code: string; module: string; description: string | null };
type Role = { id: string; code: string; nameEn: string; nameAr: string | null; isSystem: boolean; status: string; userCount: number; permissionIds: string[] };
type Data = { roles: Role[]; permissions: Permission[] };

export function RoleManagement({ locale }: { locale: "ar" | "en" }) {
  const [data, setData] = useState<Data>({ roles: [], permissions: [] });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function load() {
    const response = await fetch("/api/admin/roles", { cache: "no-store" });
    if (response.ok) setData(await response.json());
  }
  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/roles", { cache: "no-store" })
      .then(async response => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (!cancelled && response.ok) setData(body);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const permission of data.permissions) map.set(permission.module, [...(map.get(permission.module) || []), permission]);
    return [...map.entries()];
  }, [data.permissions]);

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin/roles", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: form.get("code"), nameEn: form.get("nameEn"), nameAr: form.get("nameAr"), permissionIds: form.getAll("permissionIds") }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      event.currentTarget.reset();
      setMessage(tr("Role created successfully.", "تم إنشاء الدور بنجاح."));
      setCreateOpen(false);
      await load();
    } else setMessage(body.error === "invalid_fields" ? tr("Enter a role name and select at least one permission.", "أدخل اسم الدور واختر صلاحية واحدة على الأقل.") : tr("Unable to create role. Code may already exist.", "تعذر إنشاء الدور. قد يكون الرمز مستخدمًا."));
    setBusy(false);
  }

  async function toggleRole(role: Role) {
    if (role.isSystem) return;
    setBusy(true);
    const response = await fetch("/api/admin/roles/" + role.id, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: role.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
    });
    if (!response.ok) setMessage(tr("Unable to update role.", "تعذر تحديث الدور."));
    await load();
    setBusy(false);
  }

  return <div className="admin-grid">
    <div className="admin-page-actions">
      {message && <span className="crud-success-toast">{message}</span>}
      <button type="button" className="primary-button" onClick={() => { setMessage(""); setCreateOpen(true); }}>
        <SystemIcon name="plus" size={16} />{tr("Add Role", "إضافة دور")}
      </button>
    </div>

    <CrudModal
      open={createOpen}
      onClose={() => setCreateOpen(false)}
      title={tr("Create role", "إنشاء دور")}
      description={tr("Choose the permissions this role grants. Staff inherit permissions through assigned roles.", "اختر الصلاحيات التي يمنحها الدور، ثم يُسند الدور للمستخدمين.")}
      size="xl"
    >
      <form className="form-stack modal-form-stack" onSubmit={createRole}>
        <div className="settings-grid"><label>{tr("Role code", "رمز الدور")}<input name="code" required placeholder="LAB_TECH" pattern="[A-Za-z0-9._-]{2,80}" /></label><label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" required /></label><label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" /></label></div>
        <div className="permission-groups">{grouped.map(([module, permissions]) => <fieldset className="permission-group" key={module}><legend>{module}</legend>{permissions.map(permission => <label key={permission.id}><input type="checkbox" name="permissionIds" value={permission.id} /><span><strong>{permission.code}</strong><small>{permission.description || ""}</small></span></label>)}</fieldset>)}</div>
        <div className="crud-modal-actions"><button className="primary-button" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create role", "إنشاء الدور")}</button></div>
        {message && <div className="form-success">{message}</div>}
      </form>
    </CrudModal>

    <section className="table-card admin-table-card">
      <div className="table-toolbar"><div><h2>{tr("Roles", "الأدوار")}</h2><span>{tr("System roles are protected from destructive editing.", "أدوار النظام محمية من التعديل التخريبي.")}</span></div><span>{data.roles.length}</span></div>
      <div className="table-wrap"><table><thead><tr><th>{tr("Role", "الدور")}</th><th>{tr("Users", "المستخدمون")}</th><th>{tr("Permissions", "الصلاحيات")}</th><th>{tr("Status", "الحالة")}</th><th>{tr("Actions", "إجراءات")}</th></tr></thead><tbody>{data.roles.map(role => <tr key={role.id}><td><strong>{locale === "ar" ? role.nameAr || role.nameEn : role.nameEn}</strong><small className="table-subtext">{role.code}{role.isSystem ? ` · ${tr("System", "نظامي")}` : ""}</small></td><td>{role.userCount}</td><td>{role.permissionIds.length}</td><td><span className={"status-badge " + (role.status === "ACTIVE" ? "status-active" : "status-warning")}>{statusLabel(locale, role.status)}</span></td><td>{role.isSystem ? <span className="muted">{tr("Protected", "محمي")}</span> : <button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => void toggleRole(role)}>{role.status === "ACTIVE" ? tr("Deactivate", "تعطيل") : tr("Activate", "تفعيل")}</button>}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
