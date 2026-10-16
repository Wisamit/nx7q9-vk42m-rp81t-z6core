"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { SystemIcon } from "@/components/system-icon";
import { CrudModal } from "@/components/crud-modal";
import { statusLabel } from "@/lib/ui-i18n";

type Role = { id: string; code: string; nameEn: string; nameAr: string | null; isSystem: boolean; discountLimitPercent?: string };
type Branch = { id: string; code: string; nameEn: string; nameAr: string | null };
type Department = { id: string; code: string; nameEn: string; nameAr: string | null; branchId: string | null };
type UserRow = {
  id: string; username: string; email: string | null; displayNameEn: string; displayNameAr: string | null;
  preferredLocale: string; status: string; mfaEnabled: boolean; lastLoginAt: string | null;
  discountLimitPercent?: string | null; effectiveDiscountLimitPercent?: string;
  roleIds: string[]; roleNames: string[]; branchIds: string[]; branchNames: string[]; departmentIds: string[]; departmentNames: string[];
};
type Data = { users: UserRow[]; roles: Role[]; branches: Branch[]; departments: Department[] };

export function UserManagement({ locale, canManageDiscountLimits, canResetPasswords, currentUserId }: {
  locale: "ar" | "en"; canManageDiscountLimits: boolean;
  canResetPasswords: boolean; currentUserId: string;
}) {
  const [data, setData] = useState<Data>({ users: [], roles: [], branches: [], departments: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [isError, setIsError] = useState(false);
  const [message, setMessage] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [resetting, setResetting] = useState<UserRow | null>(null);
  const [resetError, setResetError] = useState("");
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
    if (inFlight.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch("/api/admin/users", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.get("username"),
          email: form.get("email"),
          displayNameEn: form.get("displayNameEn"),
          displayNameAr: form.get("displayNameAr"),
          password: form.get("password"),
          preferredLocale: form.get("preferredLocale"),
          ...(canManageDiscountLimits ? { discountLimitPercent: form.get("discountLimitPercent") } : {}),
          roleIds: form.getAll("roleIds"),
          branchIds: form.getAll("branchIds"),
          departmentIds: form.getAll("departmentIds"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setIsError(true);
        setMessage(body.error === "invalid_scope"
          ? tr("Select valid roles and branches.", "اختر أدوارًا وفروعًا صحيحة.")
          : tr("Unable to create user. Username may already exist.", "تعذر إنشاء المستخدم. قد يكون اسم المستخدم مستخدمًا."));
        return;
      }
      formElement.reset();
      setMessage(tr("User created successfully.", "تم إنشاء المستخدم بنجاح."));
      setCreateOpen(false);
      await load();
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Check the staff directory before issuing another user or temporary password.",
        "انقطع الاتصال. تحقق من دليل الموظفين قبل إنشاء مستخدم أو كلمة مرور مؤقتة أخرى.",
      ));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function updateAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || inFlight.current) return;
    const form = new FormData(event.currentTarget);
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch("/api/admin/users/" + editing.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleIds: form.getAll("roleIds"),
          branchIds: form.getAll("branchIds"),
          departmentIds: form.getAll("departmentIds"),
          ...(canManageDiscountLimits ? { discountLimitPercent: form.get("discountLimitPercent") } : {}),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setIsError(true);
        setMessage(body.error === "invalid_scope"
          ? tr("Department access must match the selected branches.", "يجب أن تتوافق صلاحيات الأقسام مع الفروع المحددة.")
          : tr("Unable to update access.", "تعذر تحديث صلاحيات الوصول."));
        return;
      }
      setEditing(null);
      setMessage(tr("Access updated successfully.", "تم تحديث صلاحيات الوصول بنجاح."));
      await load();
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Verify staff branch and role assignments before trying again.",
        "انقطع الاتصال. تحقق من تعيينات الفروع والأدوار قبل إعادة المحاولة.",
      ));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function resetStaffPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || !resetting || !canResetPasswords || resetting.id === currentUserId) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    if (fields.get("newPassword") !== fields.get("confirmPassword")) {
      setResetError(tr("New passwords do not match.", "كلمتا المرور الجديدتان غير متطابقتين."));
      return;
    }
    inFlight.current = true;
    setBusy(true); setResetError("");
    try {
      const response = await fetch("/api/admin/users/" + resetting.id + "/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actorPassword: fields.get("actorPassword"),
          newPassword: fields.get("newPassword"),
          confirmPassword: fields.get("confirmPassword"),
          reason: fields.get("reason"),
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (response.ok) {
        form.reset();
        setResetting(null);
        setMessage(tr(
          "Staff password reset; prior sessions revoked. Tell the staff member the new password through a secure channel and ask them to change it promptly.",
          "تم تعيين كلمة المرور وإلغاء الجلسات السابقة. سلّم كلمة المرور للموظف بقناة آمنة واطلب منه تغييرها فورًا.",
        ));
        await load();
      } else {
        const errors: Record<string,[string,string]> = {
          actor_password_invalid: ["Your current administrator password is incorrect.", "كلمة مرور المدير الحالية غير صحيحة."],
          password_policy_failed: ["Password must be at least 12 characters and at most 72 UTF-8 bytes.", "كلمة المرور يجب ألا تقل عن 12 محرفًا أو تتجاوز 72 بايت UTF-8."],
          recovery_reason_required: ["Enter a 10–1000-character documented reset reason.", "أدخل سببًا موثقًا من 10 إلى 1000 محرف."],
          target_not_active_or_authorized: ["Target is inactive or not authorized.", "المستخدم غير فعّال أو غير مسموح."],
          rate_limited: ["Too many reset attempts. Try later.", "تجاوزت عدد المحاولات المسموح، حاول لاحقًا."],
          system_admin_required: ["System administrator rights are required.", "يجب امتلاك صلاحيات مدير النظام."],
        };
        setResetError(errors[body.error || ""]?.[locale === "ar" ? 1 : 0] ||
          tr("Secure reset failed. Verify status before retrying.", "فشلت إعادة التعيين. تحقق من الحالة قبل إعادة المحاولة."));
      }
    } catch {
      setResetError(tr("Connection failed. Check the user's login state before retrying.",
        "فشل الاتصال. تحقق من حالة دخول الموظف قبل إعادة المحاولة."));
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function setStatus(user: UserRow, status: "ACTIVE" | "SUSPENDED") {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch("/api/admin/users/" + user.id, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setIsError(true);
        setMessage(body.error === "last_system_admin"
          ? tr("The last system administrator cannot be disabled.", "لا يمكن تعطيل آخر مدير للنظام.")
          : tr("Unable to update user.", "تعذر تحديث المستخدم."));
      }
      await load();
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Reload staff status before another access change.",
        "انقطع الاتصال. أعد تحميل حالة المستخدم قبل تغيير آخر للصلاحيات.",
      ));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <div className="admin-grid">
    <div className="admin-page-actions">
      {message && !isError && <span className="crud-success-toast" role="status">{message}</span>}
      <button type="button" className="primary-button" disabled={busy} onClick={() => { setIsError(false); setMessage(""); setCreateOpen(true); }}>
        <SystemIcon name="plus" size={16} />{tr("Add User", "إضافة مستخدم")}
      </button>
    </div>

    <CrudModal
      open={createOpen}
      onClose={() => { if (!inFlight.current) setCreateOpen(false); }}
      title={tr("Create staff user", "إنشاء مستخدم موظف")}
      description={tr("Assign role-based permissions and explicit branch access.", "حدد الدور والصلاحيات والفروع المسموح بها.")}
      size="compact"
    >
      <form className="settings-grid" onSubmit={createUser}>
        <label>{tr("English display name", "الاسم بالإنجليزية")}<input name="displayNameEn" required /></label>
        <label>{tr("Arabic display name", "الاسم بالعربية")}<input name="displayNameAr" /></label>
        <label>{tr("Username", "اسم المستخدم")}<input name="username" required minLength={3} autoCapitalize="none" /></label>
        <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" /></label>
        <label>{tr("Temporary password", "كلمة المرور المؤقتة")}<input name="password" type="password" required minLength={12} autoComplete="new-password" /><small>{tr("Minimum 12 characters.", "12 محرفًا على الأقل.")}</small></label>
        <label>{tr("Preferred language", "اللغة المفضلة")}<select name="preferredLocale" defaultValue="en"><option value="en">{tr("English", "الإنجليزية")}</option><option value="ar">العربية</option></select></label>
        {canManageDiscountLimits && <label>{tr("Discount limit override (%)", "تجاوز حد الخصم للمستخدم (%)")}<input name="discountLimitPercent" type="number" min="0" max="100" step="0.01" placeholder={tr("Leave blank to inherit from roles", "اتركه فارغًا ليرث من الأدوار")} /></label>}
        <fieldset className="admin-checklist"><legend>{tr("Roles", "الأدوار")}</legend>{data.roles.map(role => <label key={role.id}><input type="checkbox" name="roleIds" value={role.id} />{locale === "ar" ? role.nameAr || role.nameEn : role.nameEn}</label>)}</fieldset>
        <fieldset className="admin-checklist"><legend>{tr("Branch access", "صلاحية الفروع")}</legend>{data.branches.map(branch => <label key={branch.id}><input type="checkbox" name="branchIds" value={branch.id} />{branch.code} — {locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn}</label>)}</fieldset>
        <fieldset className="admin-checklist form-span"><legend>{tr("Department access", "صلاحية الأقسام")}</legend><small>{tr("Optional: no selection means all departments within the selected branches. Selecting departments restricts clinical access.", "اختياري: عدم التحديد يعني كل الأقسام ضمن الفروع المختارة. تحديد أقسام يقيّد الوصول السريري بها.")}</small>{data.departments.map(department => <label key={department.id}><input type="checkbox" name="departmentIds" value={department.id} />{department.code} — {locale === "ar" ? department.nameAr || department.nameEn : department.nameEn}</label>)}</fieldset>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create user", "إنشاء المستخدم")}</button>
        {message && <div className={(isError ? "form-error" : "form-success") + " form-span"} role={isError ? "alert" : "status"}>{message}</div>}
      </form>
    </CrudModal>

    <CrudModal
      open={Boolean(editing)}
      onClose={() => { if (!inFlight.current) setEditing(null); }}
      title={tr("Edit access", "تعديل صلاحيات الوصول")}
      description={editing ? editing.displayNameEn + " · @" + editing.username : undefined}
      size="compact"
    >
      {editing && <form className="settings-grid" onSubmit={updateAccess}>
        {canManageDiscountLimits && <label>{tr("Discount limit override (%)", "تجاوز حد الخصم للمستخدم (%)")}<input name="discountLimitPercent" type="number" min="0" max="100" step="0.01" defaultValue={editing.discountLimitPercent || ""} placeholder={tr("Leave blank to inherit from roles", "اتركه فارغًا ليرث من الأدوار")} /><small>{tr("Current effective limit", "الحد الفعلي الحالي")}: {Number(editing.effectiveDiscountLimitPercent || 0).toFixed(2)}%</small></label>}
        <fieldset className="admin-checklist"><legend>{tr("Roles", "الأدوار")}</legend>{data.roles.map(role => <label key={role.id}><input type="checkbox" name="roleIds" value={role.id} defaultChecked={editing.roleIds.includes(role.id)} />{locale === "ar" ? role.nameAr || role.nameEn : role.nameEn}{canManageDiscountLimits ? ` · ${Number(role.discountLimitPercent || 0).toFixed(2)}%` : ""}</label>)}</fieldset>
        <fieldset className="admin-checklist"><legend>{tr("Branch access", "صلاحية الفروع")}</legend>{data.branches.map(branch => <label key={branch.id}><input type="checkbox" name="branchIds" value={branch.id} defaultChecked={editing.branchIds.includes(branch.id)} />{branch.code} — {locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn}</label>)}</fieldset>
        <fieldset className="admin-checklist form-span"><legend>{tr("Department access", "صلاحية الأقسام")}</legend><small>{tr("No department selection means unrestricted department access inside the selected branches.", "عدم تحديد أقسام يعني السماح بكل الأقسام ضمن الفروع المحددة.")}</small>{data.departments.map(department => <label key={department.id}><input type="checkbox" name="departmentIds" value={department.id} defaultChecked={editing.departmentIds.includes(department.id)} />{department.code} — {locale === "ar" ? department.nameAr || department.nameEn : department.nameEn}</label>)}</fieldset>
        <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Save access", "حفظ الصلاحيات")}</button>
      </form>}
    </CrudModal>

    <CrudModal
      open={Boolean(resetting)}
      onClose={() => { if (!inFlight.current) { setResetting(null); setResetError(""); } }}
      title={tr("Secure staff password reset", "إعادة تعيين كلمة مرور الموظف بأمان")}
      description={resetting ? resetting.displayNameEn + " · @" + resetting.username : undefined}
      size="compact"
    >
      {resetting && <form className="settings-grid" onSubmit={e => void resetStaffPassword(e)}>
        <p className="muted form-span">{tr(
          "Review the selected staff account carefully before confirmation. Only an authorized system admin may reset another active staff account. You must re-enter YOUR own password. Submitting this form immediately revokes ALL target sessions and requires a fresh login. MFA remains enabled.",
          "راجع حساب الموظف المحدد قبل التأكيد. يحق فقط لمدير نظام مخوّل إعادة تعيين كلمة مرور موظف آخر فعّال. أدخل كلمة مرور المدير الخاصة بك؛ يؤدي إرسال هذا النموذج فوراً إلى إلغاء جميع جلسات الموظف وطلب دخول جديد، مع بقاء MFA مفعّلة.",
        )}</p>
        <label>{tr("Your administrator password", "كلمة مرور المدير الخاصة بك")}
          <input type="password" name="actorPassword" required autoComplete="current-password" /></label>
        <label>{tr("New staff temporary password", "كلمة المرور المؤقتة الجديدة للموظف")}
          <input type="password" name="newPassword" minLength={12} required autoComplete="new-password" /></label>
        <label>{tr("Confirm new staff password", "تأكيد كلمة المرور الجديدة")}
          <input type="password" name="confirmPassword" minLength={12} required autoComplete="new-password" /></label>
        <label className="form-span">{tr("Audit reason (minimum 10 characters)", "سبب الإجراء للتدقيق (10 محارف على الأقل)")}
          <textarea name="reason" minLength={10} maxLength={1000} required rows={3} /></label>
        <button type="submit" className="primary-button form-span" disabled={busy}>
          {busy ? tr("Verifying and resetting…", "جارٍ التحقق وإعادة التعيين…") :
            tr("Reset password and revoke sessions", "تغيير كلمة المرور وإلغاء الجلسات")}
        </button>
        {resetError && <p className="form-warning form-span" role="alert">{resetError}</p>}
      </form>}
    </CrudModal>

    <section className="table-card admin-table-card">
      <div className="table-toolbar"><div><h2>{tr("Staff users", "المستخدمون")}</h2><span>{tr("Roles, branches, MFA and account state", "الأدوار والفروع وMFA وحالة الحساب")}</span></div><span>{data.users.length}</span></div>
      <div className="table-wrap">{loading ? <div className="empty-state">{tr("Loading…", "جارٍ التحميل…")}</div> : <table><thead><tr><th>{tr("User", "المستخدم")}</th><th>{tr("Roles", "الأدوار")}</th><th>{tr("Branches", "الفروع")}</th><th>{tr("Departments", "الأقسام")}</th>{canManageDiscountLimits && <th>{tr("Discount limit", "حد الخصم")}</th>}<th>{tr("MFA", "المصادقة متعددة العوامل")}</th><th>{tr("Status", "الحالة")}</th><th>{tr("Actions", "إجراءات")}</th></tr></thead>
      <tbody>{data.users.map(user => <tr key={user.id}><td><strong>{locale === "ar" ? user.displayNameAr || user.displayNameEn : user.displayNameEn}</strong><small className="table-subtext">@{user.username}{user.email ? " · " + user.email : ""}</small></td><td>{localizedRoleNames(user)}</td><td>{localizedBranchNames(user)}</td><td>{localizedDepartmentNames(user)}</td>{canManageDiscountLimits && <td>{Number(user.effectiveDiscountLimitPercent || 0).toFixed(2)}%{user.discountLimitPercent !== null ? <small className="table-subtext">{tr("User override", "تجاوز مستخدم")}</small> : <small className="table-subtext">{tr("Inherited", "موروث")}</small>}</td>}<td><span className={"status-badge " + (user.mfaEnabled ? "status-active" : "status-draft")}>{user.mfaEnabled ? tr("ON", "مفعلة") : tr("OFF", "غير مفعلة")}</span></td><td><span className={"status-badge " + (user.status === "ACTIVE" ? "status-active" : "status-warning")}>{statusLabel(locale, user.status)}</span></td><td><div className="inline-actions">
  <button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => setEditing(user)}>{tr("Edit access", "تعديل الصلاحيات")}</button>
  {canResetPasswords && user.id !== currentUserId && user.status === "ACTIVE" && <button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => { setResetError(""); setResetting(user); }}>{tr("Reset password", "إعادة تعيين كلمة المرور")}</button>}
  {user.status === "ACTIVE" ? <button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => void setStatus(user, "SUSPENDED")}>{tr("Suspend", "تعليق")}</button> : <button type="button" className="secondary-button compact-action" disabled={busy} onClick={() => void setStatus(user, "ACTIVE")}>{tr("Activate", "تفعيل")}</button>}
</div></td></tr>)}</tbody></table>}</div>
    </section>
  </div>;
}
