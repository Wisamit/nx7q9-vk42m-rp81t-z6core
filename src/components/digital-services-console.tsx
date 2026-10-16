"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CrudModal } from "@/components/crud-modal";
import { statusLabel as sharedStatusLabel } from "@/lib/ui-i18n";

type Option = { id: string; label: string };
type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type PortalAccount = {
  id: string;
  type: string;
  subject: string;
  contact: string;
  status: string;
  mustChangePassword: boolean;
};
type Appointment = {
  id: string;
  appointmentNumber: string;
  patient: string;
  branch: string;
  mode: string;
  scheduledStart: string;
  status: string;
};
type HomeCollection = {
  id: string;
  appointmentNumber: string;
  patient: string;
  branch: string;
  collector: string | null;
  status: string;
  scheduledStart: string;
};
type CorporateAccess = {
  id: string;
  client: string;
  patient: string;
  employeeNumber: string | null;
  canBook: boolean;
  canViewReports: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
};
type QueueTicket = {
  id: string;
  ticketNumber: string;
  patient: string;
  branch: string;
  stage: string;
  status: string;
  priority: number;
  counterLabel: string | null;
  issuedAt: string;
};

export function DigitalServicesConsole({
  permissions,
  branches,
  patients,
  referrers,
  clients,
  users,
  portalAccounts,
  corporateAccess,
  appointments,
  homeCollections,
  queueTickets,
  locale,
}: {
  permissions: { portalAccounts: boolean; appointments: boolean; homeCollection: boolean; queue: boolean };
  branches: Branch[];
  patients: Option[];
  referrers: Option[];
  clients: Option[];
  users: Option[];
  portalAccounts: PortalAccount[];
  corporateAccess: CorporateAccess[];
  appointments: Appointment[];
  homeCollections: HomeCollection[];
  queueTickets: QueueTicket[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [uiDialog, setUiDialog] = useState("");
  const [sensitiveAction, setSensitiveAction] = useState<{ kind: "portal-status" | "portal-password" | "appointment-cancel" | "queue-call"; id: string; status?: "ACTIVE" | "DISABLED" } | null>(null);
  const [portalType, setPortalType] = useState("PATIENT");
  const [collectorByVisit, setCollectorByVisit] = useState<Record<string, string>>({});
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const branchName = (branch: Branch) => locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn;
  const statusLabel = (value: string) => {
    const labels: Record<string, [string, string]> = {
      REQUESTED: ["Requested", "مطلوب"],
      CONFIRMED: ["Confirmed", "مؤكد"],
      CHECKED_IN: ["Checked in", "تم تسجيل الحضور"],
      COMPLETED: ["Completed", "مكتمل"],
      CANCELLED: ["Cancelled", "ملغى"],
      NO_SHOW: ["No show", "لم يحضر"],
      SCHEDULED: ["Scheduled", "مجدول"],
      ASSIGNED: ["Assigned", "تم التعيين"],
      EN_ROUTE: ["En route", "في الطريق"],
      ARRIVED: ["Arrived", "وصل"],
      COLLECTING: ["Collecting", "جارٍ السحب"],
      COLLECTED: ["Collected", "تم السحب"],
      DELIVERED: ["Delivered", "تم التسليم"],
      WAITING: ["Waiting", "بانتظار الخدمة"],
      CALLED: ["Called", "تم النداء"],
      SERVING: ["Serving", "قيد الخدمة"],
      DISABLED: ["Disabled", "معطل"],
      ACTIVE: ["Active", "نشط"],
    };
    const label = labels[value];
    return label ? tr(label[0], label[1]) : sharedStatusLabel(locale, value);
  };
  const portalTypeLabel = (value: string) =>
    value === "PATIENT" ? tr("Patient", "مريض") :
    value === "DOCTOR" ? tr("Doctor", "طبيب") :
    value === "CORPORATE" ? tr("Corporate", "شركة") :
    value;
  const modeLabel = (value: string) =>
    value === "ONSITE" ? tr("Onsite", "داخل المختبر") :
    value === "HOME_COLLECTION" ? tr("Home collection", "سحب منزلي") :
    value;
  const stageLabel = (value: string) =>
    value === "RECEPTION" ? tr("Reception", "الاستقبال") :
    value === "PHLEBOTOMY" ? tr("Phlebotomy", "سحب الدم") :
    value;

  async function send(url: string, method: "POST" | "PATCH", payload: unknown, key: string, successEn: string, successAr: string) {
    if (busy) return false;
    setBusy(key);
    setMessage("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(body.error || tr("Action failed.", "فشلت العملية."));
        return false;
      }
      setMessage(tr(successEn, successAr));
      router.refresh();
      return true;
    } catch {
      setMessage(tr("Connection error; action not confirmed.", "خطأ في الاتصال؛ لم يتم تأكيد الإجراء."));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function createPortalAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send("/api/portal-accounts", "POST", {
      type: portalType,
      patientId: portalType === "PATIENT" ? form.get("subjectId") : null,
      referrerId: portalType === "DOCTOR" ? form.get("subjectId") : null,
      clientId: portalType === "CORPORATE" ? form.get("subjectId") : null,
      email: form.get("email"),
      phone: form.get("phone"),
      preferredLocale: form.get("preferredLocale"),
    }, "portal-create", "Portal account provisioned.", "تم إنشاء حساب البوابة.");
    if (ok) event.currentTarget.reset();
  }

  async function setPortalStatus(accountId: string, status: "ACTIVE" | "DISABLED") {
    if (busy) return;
    setMessage("");
    setSensitiveAction({ kind: "portal-status", id: accountId, status });
  }

  async function setTemporaryPassword(accountId: string) {
    if (busy) return;
    setMessage("");
    setSensitiveAction({ kind: "portal-password", id: accountId });
  }

  async function createCorporateAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send("/api/corporate-portal-access", "POST", {
      clientId: form.get("clientId"),
      patientId: form.get("patientId"),
      employeeNumber: form.get("employeeNumber"),
      effectiveFrom: form.get("effectiveFrom"),
      effectiveTo: form.get("effectiveTo"),
      canBook: form.get("canBook") === "on",
      canViewReports: form.get("canViewReports") === "on",
    }, "corporate-access", "Corporate portal patient access created.", "تم إنشاء صلاحية وصول المريض عبر بوابة الشركة.");
    if (ok) event.currentTarget.reset();
  }

  async function createAppointment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const mode = String(form.get("mode") || "ONSITE");
    const ok = await send("/api/appointments", "POST", {
      branchId: form.get("branchId"),
      patientId: form.get("patientId"),
      mode,
      serviceCode: form.get("serviceCode"),
      serviceNameSnapshot: form.get("serviceNameSnapshot"),
      scheduledStart: new Date(String(form.get("scheduledStart"))).toISOString(),
      contactPhone: form.get("contactPhone"),
      address: form.get("address"),
      notes: form.get("notes"),
    }, "appointment-create", "Appointment created.", "تم إنشاء الموعد.");
    if (ok) event.currentTarget.reset();
  }

  async function changeAppointmentStatus(id: string, status: string) {
    if (status === "CANCELLED") {
      if (busy) return;
      setMessage("");
      setSensitiveAction({ kind: "appointment-cancel", id });
      return;
    }
    await send(`/api/appointments/${id}/status`, "POST", { status, reason: "" }, "appointment-" + id, "Appointment updated.", "تم تحديث الموعد.");
  }

  async function updateHomeCollection(item: HomeCollection, status: string) {
    const collectorId = status === "ASSIGNED" ? collectorByVisit[item.id] : undefined;
    if (status === "ASSIGNED" && !collectorId) {
      setMessage(tr("Select a collector before assigning the visit.", "اختر موظف السحب قبل تعيين الزيارة."));
      return;
    }
    await send(`/api/home-collections/${item.id}`, "POST", { status, assignedCollectorUserId: collectorId }, "home-" + item.id, "Home collection updated.", "تم تحديث زيارة السحب المنزلي.");
  }

  async function issueQueueTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await send("/api/queue", "POST", {
      branchId: form.get("branchId"),
      patientId: form.get("patientId"),
      appointmentId: form.get("appointmentId"),
      stage: form.get("stage"),
      priority: Number(form.get("priority") || 0),
    }, "queue-create", "Queue ticket issued.", "تم إصدار تذكرة الطابور.");
    if (ok) event.currentTarget.reset();
  }

  async function changeQueueStatus(id: string, status: string) {
    if (status === "CALLED") {
      if (busy) return;
      setMessage("");
      setSensitiveAction({ kind: "queue-call", id });
      return;
    }
    await send(`/api/queue/${id}/status`, "POST", { status, counterLabel: undefined }, "queue-" + id, "Queue ticket updated.", "تم تحديث تذكرة الطابور.");
  }

  async function confirmSensitiveAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sensitiveAction || busy) return;
    const form = new FormData(event.currentTarget);
    let success = false;
    const {kind, id, status} = sensitiveAction;
    if (kind === "portal-status" && (status === "ACTIVE" || status === "DISABLED")) {
      success = await send(`/api/portal-accounts/${id}/status`, "POST", {status},
        "portal-status-" + id,
        status === "DISABLED" ? "Portal account disabled." : "Portal account reactivated.",
        status === "DISABLED" ? "تم تعطيل حساب البوابة." : "تمت إعادة تفعيل حساب البوابة.");
    } else if (kind === "portal-password") {
      const temporaryPassword = String(form.get("temporaryPassword") || "");
      if (temporaryPassword.length < 12) {
        setMessage(tr("Use a temporary password of at least 12 characters.", "استخدم كلمة مرور مؤقتة من 12 محرفاً على الأقل."));
        return;
      }
      success = await send(`/api/portal-accounts/${id}/temporary-password`, "POST",
        {temporaryPassword}, "portal-password-" + id,
        "Temporary password set and existing portal sessions revoked.",
        "تم تعيين كلمة المرور المؤقتة وإلغاء جلسات البوابة الحالية.");
    } else if (kind === "appointment-cancel") {
      const reason = String(form.get("reason") || "").trim();
      if (!reason) {
        setMessage(tr("Cancellation reason is required.", "سبب الإلغاء مطلوب."));
        return;
      }
      success = await send(`/api/appointments/${id}/status`, "POST", {status: "CANCELLED", reason},
        "appointment-" + id, "Appointment updated.", "تم تحديث الموعد.");
    } else if (kind === "queue-call") {
      const counterLabel = String(form.get("counterLabel") || "").trim();
      success = await send(`/api/queue/${id}/status`, "POST", {status: "CALLED", counterLabel},
        "queue-" + id, "Queue ticket updated.", "تم تحديث تذكرة الطابور.");
    }
    if (success) setSensitiveAction(null);
  }

  const subjects = portalType === "PATIENT" ? patients : portalType === "DOCTOR" ? referrers : clients;

  return <section className="detail-grid detail-section">
    {permissions.portalAccounts && <article className="detail-card">
      <h2>{tr("Portal Account", "حساب البوابة")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
      onClick={() => { setMessage(""); setUiDialog("portal"); }}>
      {tr("Create Portal Account", "إنشاء حساب بوابة")}
    </button>
    <CrudModal open={uiDialog === "portal"} onClose={() => { if (!busy) setUiDialog(""); }}
      size="compact"
      title={tr("Create Portal Account", "إنشاء حساب بوابة")}
      description={tr("Account access is subject to server-side identity and role validation.", "الوصول إلى الحساب محكوم بتدقيق الهوية والصلاحيات من السيرفر.")}>
      {uiDialog === "portal" && <form className="catalog-form" onSubmit={createPortalAccount}>
        <label>{tr("Type", "النوع")}<select value={portalType} onChange={e => setPortalType(e.target.value)}>
          <option value="PATIENT">{portalTypeLabel("PATIENT")}</option>
          <option value="DOCTOR">{portalTypeLabel("DOCTOR")}</option>
          <option value="CORPORATE">{portalTypeLabel("CORPORATE")}</option>
        </select></label>
        <label>{tr("Subject", "صاحب الحساب")}<select name="subjectId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{subjects.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" /></label>
        <label>{tr("Phone", "الهاتف")}<input name="phone" /></label>
        <label>{tr("Language", "اللغة")}<select name="preferredLocale" defaultValue="en"><option value="en">{tr("English", "الإنجليزية")}</option><option value="ar">العربية</option></select></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "portal-create" ? tr("Saving…", "جارٍ الحفظ…") : tr("Provision Portal Account", "إنشاء حساب البوابة")}</button>
      </form>}
      {uiDialog === "portal" && message && <p className="form-warning" role="status">{message}</p>}
    </CrudModal>
    </article>}

    {permissions.portalAccounts && <article className="detail-card">
      <h2>{tr("Corporate Patient Access", "وصول مرضى الشركات")}</h2>
      <p className="muted">{tr("Explicitly authorize which employees/patients a corporate portal may book for and which reports it may view.", "حدد صراحةً الموظفين/المرضى الذين يمكن لبوابة الشركة الحجز لهم والتقارير التي يُسمح لها بعرضها.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
      onClick={() => { setMessage(""); setUiDialog("corporate"); }}>
      {tr("Grant Corporate Patient Access", "منح وصول لمريض عبر شركة")}
    </button>
    <CrudModal open={uiDialog === "corporate"} onClose={() => { if (!busy) setUiDialog(""); }}
      size="compact"
      title={tr("Grant Corporate Patient Access", "منح وصول لمريض عبر شركة")}
      description={tr("Select exact patient and client scope; report access follows authorization policy.", "حدد المريض والعميل بدقة؛ الوصول للتقارير يتبع سياسة التفويض.")}>
      {uiDialog === "corporate" && <form className="catalog-form" onSubmit={createCorporateAccess}>
        <label>{tr("Corporate client", "عميل الشركة")}<select name="clientId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{clients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{tr("Patient", "المريض")}<select name="patientId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{tr("Employee number", "رقم الموظف")}<input name="employeeNumber" /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <label><input name="canBook" type="checkbox" defaultChecked /> {tr("Can book", "يمكنه الحجز")}</label>
        <label><input name="canViewReports" type="checkbox" /> {tr("Can view reports", "يمكنه عرض التقارير")}</label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "corporate-access" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Corporate Access", "إضافة صلاحية شركة")}</button>
      </form>}
      {uiDialog === "corporate" && message && <p className="form-warning" role="status">{message}</p>}
    </CrudModal>
    </article>}

    {permissions.appointments && <article className="detail-card">
      <h2>{tr("Create Appointment", "إنشاء موعد")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
      onClick={() => { setMessage(""); setUiDialog("appointment"); }}>
      {tr("Create Appointment", "إنشاء موعد")}
    </button>
    <CrudModal open={uiDialog === "appointment"} onClose={() => { if (!busy) setUiDialog(""); }}
      size="compact"
      title={tr("Create Appointment", "إنشاء موعد")}
      description={tr("Review branch, patient, appointment date/time and local timezone before saving.", "راجع الفرع والمريض وموعد الحجز والمنطقة الزمنية قبل الحفظ.")}>
      {uiDialog === "appointment" && <form className="catalog-form" onSubmit={createAppointment}>
        <label>{tr("Branch", "الفرع")}<select name="branchId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{branches.map(item => <option key={item.id} value={item.id}>{item.code} — {branchName(item)}</option>)}</select></label>
        <label>{tr("Patient", "المريض")}<select name="patientId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{tr("Mode", "النمط")}<select name="mode" defaultValue="ONSITE"><option value="ONSITE">{modeLabel("ONSITE")}</option><option value="HOME_COLLECTION">{modeLabel("HOME_COLLECTION")}</option></select></label>
        <label>{tr("Service code", "رمز الخدمة")}<input name="serviceCode" /></label>
        <label className="form-span">{tr("Service name", "اسم الخدمة")}<input name="serviceNameSnapshot" required placeholder={tr("Laboratory appointment", "موعد مختبر")} /></label>
        <label>{tr("Scheduled start", "موعد البدء")}<input name="scheduledStart" type="datetime-local" required /></label>
        <label>{tr("Contact phone", "هاتف التواصل")}<input name="contactPhone" /></label>
        <label className="form-span">{tr("Home address", "عنوان المنزل")}<input name="address" /></label>
        <label className="form-span">{tr("Notes", "ملاحظات")}<textarea name="notes" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "appointment-create" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Appointment", "إنشاء الموعد")}</button>
      </form>}
      {uiDialog === "appointment" && message && <p className="form-warning" role="status">{message}</p>}
    </CrudModal>
    </article>}

    {permissions.queue && <article className="detail-card">
      <h2>{tr("Issue Queue Ticket", "إصدار تذكرة طابور")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
      onClick={() => { setMessage(""); setUiDialog("queue"); }}>
      {tr("Issue Queue Ticket", "إصدار تذكرة طابور")}
    </button>
    <CrudModal open={uiDialog === "queue"} onClose={() => { if (!busy) setUiDialog(""); }}
      size="compact"
      title={tr("Issue Queue Ticket", "إصدار تذكرة طابور")}
      description={tr("Queue tickets must be tied to the selected patient and operating branch.", "تذاكر الانتظار مرتبطة بالمريض والفرع المحددين.")}>
      {uiDialog === "queue" && <form className="catalog-form" onSubmit={issueQueueTicket}>
        <label>{tr("Branch", "الفرع")}<select name="branchId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{branches.map(item => <option key={item.id} value={item.id}>{item.code} — {branchName(item)}</option>)}</select></label>
        <label>{tr("Patient", "المريض")}<select name="patientId" required defaultValue=""><option value="">{tr("Select…", "اختر…")}</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{tr("Appointment", "الموعد")}<select name="appointmentId" defaultValue=""><option value="">{tr("Walk-in / none", "بدون موعد / حضور مباشر")}</option>{appointments.map(item => <option key={item.id} value={item.id}>{item.appointmentNumber} — {item.patient}</option>)}</select></label>
        <label>{tr("Stage", "المرحلة")}<select name="stage" defaultValue="RECEPTION"><option value="RECEPTION">{stageLabel("RECEPTION")}</option><option value="PHLEBOTOMY">{stageLabel("PHLEBOTOMY")}</option></select></label>
        <label>{tr("Priority", "الأولوية")}<input name="priority" type="number" min="-100" max="100" defaultValue="0" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "queue-create" ? tr("Issuing…", "جارٍ الإصدار…") : tr("Issue Ticket", "إصدار التذكرة")}</button>
      </form>}
      {uiDialog === "queue" && message && <p className="form-warning" role="status">{message}</p>}
    </CrudModal>
    </article>}

    {message && <div className="form-success form-span">{message}</div>}

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>{tr("Portal Accounts", "حسابات البوابة")}</h2><span>{portalAccounts.length} {tr("shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Type", "النوع")}</th><th>{tr("Subject", "صاحب الحساب")}</th><th>{tr("Contact", "التواصل")}</th><th>{tr("Status", "الحالة")}</th><th>{tr("First login", "أول تسجيل دخول")}</th><th></th></tr></thead>
        <tbody>{portalAccounts.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr("No portal accounts.", "لا توجد حسابات بوابة.")}</td></tr> : portalAccounts.map(item => <tr key={item.id}>
          <td>{portalTypeLabel(item.type)}</td><td>{item.subject}</td><td>{item.contact}</td><td>{statusLabel(item.status)}</td><td>{item.mustChangePassword ? tr("Password change required", "يجب تغيير كلمة المرور") : tr("Complete", "مكتمل")}</td>
          <td>{permissions.portalAccounts && <div className="result-actions">
            <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void setTemporaryPassword(item.id)}>{tr("Set temp password", "تعيين كلمة مرور مؤقتة")}</button>
            {item.status === "DISABLED"
              ? <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void setPortalStatus(item.id,"ACTIVE")}>{tr("Reactivate", "إعادة التفعيل")}</button>
              : <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void setPortalStatus(item.id,"DISABLED")}>{tr("Disable", "تعطيل")}</button>}
          </div>}</td>
        </tr>)}</tbody>
      </table></div>
    </article>

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>{tr("Corporate Portal Access", "صلاحيات بوابة الشركات")}</h2><span>{corporateAccess.length} {tr("shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Client", "العميل")}</th><th>{tr("Patient", "المريض")}</th><th>{tr("Employee #", "رقم الموظف")}</th><th>{tr("Booking", "الحجز")}</th><th>{tr("Reports", "التقارير")}</th><th>{tr("Effective", "السريان")}</th><th>{tr("Status", "الحالة")}</th></tr></thead>
        <tbody>{corporateAccess.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr("No corporate patient access configured.", "لا توجد صلاحيات وصول لمرضى الشركات.")}</td></tr> : corporateAccess.map(item => <tr key={item.id}>
          <td>{item.client}</td><td>{item.patient}</td><td>{item.employeeNumber || "—"}</td><td>{item.canBook ? tr("YES", "نعم") : tr("NO", "لا")}</td><td>{item.canViewReports ? tr("YES", "نعم") : tr("NO", "لا")}</td>
          <td>{item.effectiveFrom.slice(0,10)} → {item.effectiveTo?.slice(0,10) || tr("Open", "مفتوح")}</td><td>{statusLabel(item.status)}</td>
        </tr>)}</tbody>
      </table></div>
    </article>

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>{tr("Appointments", "المواعيد")}</h2><span>{appointments.length} {tr("shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Booking", "الحجز")}</th><th>{tr("Patient", "المريض")}</th><th>{tr("Branch", "الفرع")}</th><th>{tr("Mode", "النمط")}</th><th>{tr("Scheduled", "الموعد")}</th><th>{tr("Status", "الحالة")}</th><th>{tr("Actions", "الإجراءات")}</th></tr></thead>
        <tbody>{appointments.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr("No appointments.", "لا توجد مواعيد.")}</td></tr> : appointments.map(item => <tr key={item.id}>
          <td>{item.appointmentNumber}</td><td>{item.patient}</td><td>{item.branch}</td><td>{modeLabel(item.mode)}</td><td>{item.scheduledStart.replace("T"," ").slice(0,16)}</td><td>{statusLabel(item.status)}</td>
          <td className="result-actions">
            {permissions.appointments && item.status === "REQUESTED" && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"CONFIRMED")}>{tr("Confirm", "تأكيد")}</button>}
            {permissions.appointments && item.status === "CONFIRMED" && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"CHECKED_IN")}>{tr("Check in", "تسجيل الحضور")}</button>}
            {permissions.appointments && item.status === "CHECKED_IN" && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"COMPLETED")}>{tr("Complete", "إكمال")}</button>}
            {permissions.appointments && !["COMPLETED","CANCELLED","NO_SHOW"].includes(item.status) && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"CANCELLED")}>{tr("Cancel", "إلغاء")}</button>}
          </td>
        </tr>)}</tbody>
      </table></div>
    </article>

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>{tr("Home Collection", "السحب المنزلي")}</h2><span>{homeCollections.length} {tr("shown", "معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Booking", "الحجز")}</th><th>{tr("Patient", "المريض")}</th><th>{tr("Branch", "الفرع")}</th><th>{tr("Scheduled", "الموعد")}</th><th>{tr("Collector", "موظف السحب")}</th><th>{tr("Status", "الحالة")}</th><th>{tr("Next", "التالي")}</th></tr></thead>
        <tbody>{homeCollections.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr("No home collection visits.", "لا توجد زيارات سحب منزلي.")}</td></tr> : homeCollections.map(item => <tr key={item.id}>
          <td><Link className="table-link" href={`/home-collections/${item.id}`}>{item.appointmentNumber}</Link></td><td>{item.patient}</td><td>{item.branch}</td><td>{item.scheduledStart.replace("T"," ").slice(0,16)}</td><td>{item.collector || tr("Unassigned", "غير معين")}</td><td>{statusLabel(item.status)}</td>
          <td>{permissions.homeCollection && <>
            {item.status === "SCHEDULED" && <div className="result-actions">
              <select value={collectorByVisit[item.id] || ""} onChange={event => setCollectorByVisit(current => ({ ...current, [item.id]: event.target.value }))}>
                <option value="">{tr("Collector…", "موظف السحب…")}</option>
                {users.map(user => <option key={user.id} value={user.id}>{user.label}</option>)}
              </select>
              <button className="secondary-button" onClick={() => void updateHomeCollection(item,"ASSIGNED")}>{tr("Assign", "تعيين")}</button>
            </div>}
            {item.status === "ASSIGNED" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"EN_ROUTE")}>{tr("En route", "في الطريق")}</button>}
            {item.status === "EN_ROUTE" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"ARRIVED")}>{tr("Arrived", "وصل")}</button>}
            {item.status === "ARRIVED" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"COLLECTING")}>{tr("Start collection", "بدء السحب")}</button>}
            {item.status === "COLLECTING" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"COLLECTED")}>{tr("Collected", "تم السحب")}</button>}
            {item.status === "COLLECTED" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"DELIVERED")}>{tr("Delivered", "تم التسليم")}</button>}
          </>}</td>
        </tr>)}</tbody>
      </table></div>
    </article>

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>{tr("Queue", "الطابور")}</h2><span>{queueTickets.length} {tr("active/recent", "نشطة/حديثة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Ticket", "التذكرة")}</th><th>{tr("Patient", "المريض")}</th><th>{tr("Branch", "الفرع")}</th><th>{tr("Stage", "المرحلة")}</th><th>{tr("Status", "الحالة")}</th><th>{tr("Counter", "الشباك")}</th><th>{tr("Actions", "الإجراءات")}</th></tr></thead>
        <tbody>{queueTickets.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr("No queue tickets.", "لا توجد تذاكر طابور.")}</td></tr> : queueTickets.map(item => <tr key={item.id}>
          <td><strong>{item.ticketNumber}</strong></td><td>{item.patient}</td><td>{item.branch}</td><td>{stageLabel(item.stage)}</td><td>{statusLabel(item.status)}</td><td>{item.counterLabel || "—"}</td>
          <td className="result-actions">{permissions.queue && <>
            {item.status === "WAITING" && <button className="secondary-button" onClick={() => void changeQueueStatus(item.id,"CALLED")}>{tr("Call", "نداء")}</button>}
            {item.status === "CALLED" && <button className="secondary-button" onClick={() => void changeQueueStatus(item.id,"SERVING")}>{tr("Start", "بدء الخدمة")}</button>}
            {item.status === "SERVING" && <button className="secondary-button" onClick={() => void changeQueueStatus(item.id,"COMPLETED")}>{tr("Complete", "إكمال")}</button>}
          </>}</td>
        </tr>)}</tbody>
      </table></div>
    </article>
    <CrudModal open={sensitiveAction !== null}
      onClose={() => { if (!busy) setSensitiveAction(null); }}
      size="compact"
      title={sensitiveAction?.kind === "portal-password"
        ? tr("Reset Portal Password", "إعادة تعيين كلمة مرور البوابة")
        : sensitiveAction?.kind === "portal-status"
        ? tr("Confirm Portal Account Status", "تأكيد حالة حساب البوابة")
        : sensitiveAction?.kind === "appointment-cancel"
        ? tr("Cancel Appointment", "إلغاء الموعد")
        : tr("Call Queue Ticket", "نداء تذكرة الطابور")}
      description={tr(
        "Review this action. Access, appointment and queue changes are audited by the existing server workflow.",
        "راجع هذا الإجراء. تخضع تغييرات الوصول والمواعيد والطابور للتدقيق ضمن السيرفر الحالي.",
      )}>
      {sensitiveAction && <form className="catalog-form" onSubmit={confirmSensitiveAction}>
        {sensitiveAction.kind === "portal-status" && <p className="form-span">
          {sensitiveAction.status === "DISABLED"
            ? tr("Disable this account and revoke existing sessions?", "تعطيل هذا الحساب وإلغاء الجلسات النشطة؟")
            : tr("Reactivate this portal account?", "إعادة تفعيل حساب البوابة؟")}
        </p>}
        {sensitiveAction.kind === "portal-password" && <label className="form-span">
          {tr("Temporary password (minimum 12 characters)", "كلمة مرور مؤقتة (12 محرفاً على الأقل)")}
          <input name="temporaryPassword" type="password" minLength={12} autoComplete="new-password" required />
        </label>}
        {sensitiveAction.kind === "portal-password" && <p className="muted form-span">
          {tr("The portal user must change this password at first login; existing sessions will be revoked.",
            "يجب أن يغيّر مستخدم البوابة كلمة المرور عند أول دخول، وستلغى الجلسات القائمة.")}
        </p>}
        {sensitiveAction.kind === "appointment-cancel" && <label className="form-span">
          {tr("Cancellation reason (required)", "سبب إلغاء الموعد (مطلوب)")}
          <textarea name="reason" rows={3} maxLength={1000} required />
        </label>}
        {sensitiveAction.kind === "queue-call" && <label className="form-span">
          {tr("Counter or workstation (optional)", "اسم الشباك أو محطة العمل (اختياري)")}
          <input name="counterLabel" maxLength={120}/>
        </label>}
        {message && <p className="form-warning form-span" role="status">{message}</p>}
        <button type="submit" className="primary-button form-span" disabled={Boolean(busy)}>
          {busy ? tr("Processing…", "جارٍ التنفيذ…") : tr("Confirm action", "تأكيد الإجراء")}
        </button>
      </form>}
    </CrudModal>
  </section>;
}
