"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { SystemIcon } from "@/components/system-icon";
import { CrudModal } from "@/components/crud-modal";
import { statusLabel } from "@/lib/ui-i18n";

type Permission = { id: string; code: string; module: string; description: string | null };
type Role = { id: string; code: string; nameEn: string; nameAr: string | null; isSystem: boolean; status: string; discountLimitPercent?: string; userCount: number; permissionIds: string[] };
type Data = { roles: Role[]; permissions: Permission[] };

export function RoleManagement({ locale, canManageDiscountLimits, canManageCashierAuthority, canManageCreditLimits, canManageTaxRules }: { locale: "ar" | "en"; canManageDiscountLimits: boolean; canManageCashierAuthority: boolean; canManageCreditLimits: boolean; canManageTaxRules: boolean }) {
  const [data, setData] = useState<Data>({ roles: [], permissions: [] });
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [isError, setIsError] = useState(false);
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Role | null>(null);
  const [statusReview, setStatusReview] = useState<Role | null>(null);
  const [permissionQuery, setPermissionQuery] = useState("");
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

  const visiblePermission = (permission: Permission) => {
    const query = permissionQuery.trim().toLowerCase();
    return !query || [permission.module, permission.code, permission.description || ""]
      .some(value => value.toLowerCase().includes(query));
  };
  const matches = data.permissions.filter(visiblePermission).length;

  const grouped = useMemo(() => {
    const map = new Map<string, Permission[]>();
    for (const permission of data.permissions) map.set(permission.module, [...(map.get(permission.module) || []), permission]);
    return [...map.entries()];
  }, [data.permissions]);

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch("/api/admin/roles", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.get("code"), nameEn: form.get("nameEn"), nameAr: form.get("nameAr"),
          ...(canManageDiscountLimits ? { discountLimitPercent: Number(form.get("discountLimitPercent") || 0) } : {}),
          permissionIds: form.getAll("permissionIds"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setIsError(true);
        setMessage(body.error === "invalid_fields"
          ? tr("Enter a role name and select at least one permission.", "أدخل اسم الدور واختر صلاحية واحدة على الأقل.")
          : tr("Unable to create role. Code may already exist.", "تعذر إنشاء الدور. قد يكون الرمز مستخدمًا."));
        return;
      }
      formElement.reset();
      setMessage(tr("Role created successfully.", "تم إنشاء الدور بنجاح."));
      setCreateOpen(false);
      await load();
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Check whether this role was already created before retrying.",
        "انقطع الاتصال. تحقق من وجود الدور قبل إعادة محاولة إنشائه.",
      ));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function updateRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || editing.isSystem || inFlight.current) return;
    const form = new FormData(event.currentTarget);
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch("/api/admin/roles/" + editing.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameEn: form.get("nameEn"), nameAr: form.get("nameAr"),
          ...(canManageDiscountLimits ? { discountLimitPercent: Number(form.get("discountLimitPercent") || 0) } : {}),
          permissionIds: form.getAll("permissionIds"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setIsError(true);
        setMessage(body.error === "invalid_fields"
          ? tr("Enter valid role details, discount limit and permissions.", "أدخل بيانات الدور وحد الخصم والصلاحيات بشكل صحيح.")
          : tr("Unable to update role.", "تعذر تحديث الدور."));
        return;
      }
      setEditing(null);
      setMessage(tr("Role updated successfully.", "تم تحديث الدور بنجاح."));
      await load();
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Check current permissions before retrying the update.",
        "انقطع الاتصال. تحقق من الصلاحيات الحالية قبل إعادة التعديل.",
      ));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function confirmRoleStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const role = statusReview;
    if (!role || role.isSystem || inFlight.current) return;
    const latest = data.roles.find(item => item.id === role.id);
    if (!latest || latest.isSystem || latest.status !== role.status) {
      setIsError(true);
      setMessage(tr("Role state changed. Reload before reviewing again.",
        "تغيّرت حالة الدور. أعد التحميل قبل المراجعة من جديد."));
      setStatusReview(null);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch("/api/admin/roles/" + role.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: role.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
      });
      if (!response.ok) {
        setIsError(true);
        setMessage(tr("Unable to update role. Verify its current state.", "تعذر تحديث الدور. تحقق من حالته الحالية."));
      } else {
        await load();
        setStatusReview(null);
        setMessage(tr("Role status updated.", "تم تحديث حالة الدور."));
      }
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Reload role status before another change.",
        "انقطع الاتصال. أعد تحميل حالة الدور قبل أي تعديل آخر.",
      ));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <div className="admin-grid">
    <div className="admin-page-actions">
      {message && !isError && <span className="crud-success-toast" role="status">{message}</span>}
      <button type="button" className="primary-button" disabled={busy} onClick={() => { setIsError(false); setMessage(""); setPermissionQuery(""); setCreateOpen(true); }}>
        <SystemIcon name="plus" size={16} />{tr("Add Role", "إضافة دور")}
      </button>
    </div>

    <CrudModal
      open={createOpen}
      onClose={() => { if (!inFlight.current) setCreateOpen(false); }}
      title={tr("Create role", "إنشاء دور")}
      description={tr("Choose the permissions this role grants. Staff inherit permissions through assigned roles.", "اختر الصلاحيات التي يمنحها الدور، ثم يُسند الدور للمستخدمين.")}
      size="compact"
    >
      <form className="form-stack modal-form-stack" onSubmit={createRole}>
        <div className="settings-grid"><label>{tr("Role code", "رمز الدور")}<input name="code" required placeholder="LAB_TECH" pattern="[A-Za-z0-9._-]{2,80}" /></label><label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" required /></label><label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" /></label>{canManageDiscountLimits && <label>{tr("Discount limit (%)", "حد الخصم (%)")}<input name="discountLimitPercent" type="number" min="0" max="100" step="0.01" defaultValue="0" required /></label>}</div>
        <label className="role-permission-search">{tr("Find permissions", "البحث في الصلاحيات")}<input type="search" data-modal-ui-only="true" value={permissionQuery} onChange={event => setPermissionQuery(event.target.value)} placeholder={tr("Search by module, code or description", "ابحث حسب الوحدة أو الرمز أو الوصف")} /></label>
        <p className="muted role-permission-count" role="status">{matches} / {data.permissions.length} {tr("permissions shown. Filtering does not change selected grants.", "صلاحية معروضة. لا يغيّر البحث الصلاحيات المحددة.")}</p>
        <div className="permission-groups">{grouped.map(([module, permissions]) => <fieldset className="permission-group" key={module} style={{display:permissions.some(visiblePermission) ? undefined : "none"}}><legend>{module}</legend>{permissions.map(permission => {
  const protectedFinancialPermission =
    (["billing.discount.approve", "billing.discount.limits.manage"].includes(permission.code) && !canManageDiscountLimits)
    || (["billing.cashier.approve", "billing.cashier.authority.manage"].includes(permission.code) && !canManageCashierAuthority)
    || (permission.code === "billing.credit.limits.manage" && !canManageCreditLimits)
    || (permission.code === "billing.tax.manage" && !canManageTaxRules);
  return <label key={permission.id} style={{display:visiblePermission(permission) ? undefined : "none"}}><input type="checkbox" name="permissionIds" value={permission.id} disabled={protectedFinancialPermission} /><span><strong>{permission.code}</strong><small>{permission.description || ""}{protectedFinancialPermission ? ` · ${tr("Financial admin only", "لمدير الصلاحيات المالية فقط")}` : ""}</small></span></label>;
})}</fieldset>)}</div>
        <div className="crud-modal-actions"><button className="primary-button" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create role", "إنشاء الدور")}</button></div>
        {message && <div className={isError ? "form-error" : "form-success"} role={isError ? "alert" : "status"}>{message}</div>}
      </form>
    </CrudModal>

    <CrudModal
      open={Boolean(editing)}
      onClose={() => { if (!inFlight.current) setEditing(null); }}
      title={tr("Edit role", "تعديل الدور")}
      description={editing ? editing.code : undefined}
      size="compact"
    >
      {editing && !editing.isSystem && <form className="form-stack modal-form-stack" onSubmit={updateRole}>
        <div className="settings-grid">
          <label>{tr("English name", "الاسم بالإنجليزية")}<input name="nameEn" required defaultValue={editing.nameEn} /></label>
          <label>{tr("Arabic name", "الاسم بالعربية")}<input name="nameAr" defaultValue={editing.nameAr || ""} /></label>
          {canManageDiscountLimits && <label>{tr("Discount limit (%)", "حد الخصم (%)")}<input name="discountLimitPercent" type="number" min="0" max="100" step="0.01" required defaultValue={editing.discountLimitPercent || "0"} /></label>}
        </div>
        <label className="role-permission-search">{tr("Find permissions", "البحث في الصلاحيات")}<input type="search" data-modal-ui-only="true" value={permissionQuery} onChange={event => setPermissionQuery(event.target.value)} placeholder={tr("Search by module, code or description", "ابحث حسب الوحدة أو الرمز أو الوصف")} /></label>
        <p className="muted role-permission-count" role="status">{matches} / {data.permissions.length} {tr("permissions shown. Filtering does not change selected grants.", "صلاحية معروضة. لا يغيّر البحث الصلاحيات المحددة.")}</p>
        <div className="permission-groups">{grouped.map(([module, permissions]) => <fieldset className="permission-group" key={module} style={{display:permissions.some(visiblePermission) ? undefined : "none"}}><legend>{module}</legend>{permissions.map(permission => {
  const protectedFinancialPermission =
    (["billing.discount.approve", "billing.discount.limits.manage"].includes(permission.code) && !canManageDiscountLimits)
    || (["billing.cashier.approve", "billing.cashier.authority.manage"].includes(permission.code) && !canManageCashierAuthority)
    || (permission.code === "billing.credit.limits.manage" && !canManageCreditLimits)
    || (permission.code === "billing.tax.manage" && !canManageTaxRules);
  const currentlyGranted = editing.permissionIds.includes(permission.id);
  return <label key={permission.id} style={{display:visiblePermission(permission) ? undefined : "none"}}>{protectedFinancialPermission && currentlyGranted && <input type="hidden" name="permissionIds" value={permission.id} />}<input type="checkbox" name="permissionIds" value={permission.id} defaultChecked={currentlyGranted} disabled={protectedFinancialPermission} /><span><strong>{permission.code}</strong><small>{permission.description || ""}{protectedFinancialPermission ? ` · ${tr("Financial admin only", "لمدير الصلاحيات المالية فقط")}` : ""}</small></span></label>;
})}</fieldset>)}</div>
        <div className="crud-modal-actions"><button className="primary-button" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Save role", "حفظ الدور")}</button></div>
        {message && isError && <p className="form-error" role="alert">{message}</p>}
      </form>}
    </CrudModal>

    <CrudModal open={statusReview !== null}
      onClose={() => { if (!inFlight.current) setStatusReview(null); }}
      title={statusReview?.status === "ACTIVE"
        ? tr("Deactivate Staff Role", "تعطيل دور الموظفين")
        : tr("Activate Staff Role", "تفعيل دور الموظفين")}
      description={tr(
        "A role status change may affect every assigned staff member across authorized branches. System roles are protected; only the server can authorize the change.",
        "قد يؤثر تغيير حالة الدور على كل الموظفين المرتبطين به في الفروع المسموح بها. أدوار النظام محمية، والخادم وحده يجيز التغيير.",
      )}
      size="compact">
      {statusReview && !statusReview.isSystem && <form className="catalog-form" onSubmit={confirmRoleStatus}>
        <p className="form-span"><strong>{tr("Role", "الدور")}:</strong>{" "}
          {locale === "ar" ? statusReview.nameAr || statusReview.nameEn : statusReview.nameEn}
          {" · " + statusReview.code}</p>
        <p className="form-span">{tr("Assigned staff accounts", "حسابات الموظفين المرتبطة")}:{" "}
          <strong>{statusReview.userCount}</strong></p>
        <p className="form-span">{tr("Current status", "الحالة الحالية")}:{" "}
          <strong>{statusLabel(locale, statusReview.status)}</strong></p>
        <p className="form-span">{tr("Requested status", "الحالة المطلوبة")}:{" "}
          <strong>{statusLabel(locale, statusReview.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")}</strong></p>
        <p className="muted form-span">{tr(
          "Confirm only after reviewing dependent staff access. Existing audit, results, invoices and historical permissions are not deleted.",
          "أكد فقط بعد مراجعة وصول الموظفين المتأثرين. لا تُحذف سجلات التدقيق أو النتائج أو الفواتير أو الصلاحيات التاريخية.",
        )}</p>
        {message && isError && <p role="alert" className="form-error form-span">{message}</p>}
        <div className="crud-modal-actions form-span">
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => setStatusReview(null)}>{tr("Cancel", "إلغاء")}</button>
          <button type="submit" className="primary-button" disabled={busy}>
            {busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Confirm status change", "تأكيد تغيير الحالة")}
          </button>
        </div>
      </form>}
    </CrudModal>

    <section className="table-card admin-table-card">
      <div className="table-toolbar"><div><h2>{tr("Roles", "الأدوار")}</h2><span>{tr("System roles are protected from destructive editing.", "أدوار النظام محمية من التعديل التخريبي.")}</span></div><span>{data.roles.length}</span></div>
      <div className="table-wrap"><table><thead><tr><th>{tr("Role", "الدور")}</th><th>{tr("Users", "المستخدمون")}</th><th>{tr("Permissions", "الصلاحيات")}</th>{canManageDiscountLimits && <th>{tr("Discount limit", "حد الخصم")}</th>}<th>{tr("Status", "الحالة")}</th><th>{tr("Actions", "إجراءات")}</th></tr></thead><tbody>{data.roles.map(role => <tr key={role.id}><td><strong>{locale === "ar" ? role.nameAr || role.nameEn : role.nameEn}</strong><small className="table-subtext">{role.code}{role.isSystem ? ` · ${tr("System", "نظامي")}` : ""}</small></td><td>{role.userCount}</td><td>{role.permissionIds.length}</td>{canManageDiscountLimits && <td>{Number(role.discountLimitPercent || 0).toFixed(2)}%</td>}<td><span className={"status-badge " + (role.status === "ACTIVE" ? "status-active" : "status-warning")}>{statusLabel(locale, role.status)}</span></td><td>{role.isSystem ? <span className="muted">{tr("Protected", "محمي")}</span> : <div className="inline-actions"><button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => { setPermissionQuery(""); setEditing(role); }}>{tr("Edit", "تعديل")}</button><button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => { setIsError(false); setMessage(""); setStatusReview(role); }}>{role.status === "ACTIVE" ? tr("Deactivate", "تعطيل") : tr("Activate", "تفعيل")}</button></div>}</td></tr>)}</tbody></table></div>
    </section>
  </div>;
}
