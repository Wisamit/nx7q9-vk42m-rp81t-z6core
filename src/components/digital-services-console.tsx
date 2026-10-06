"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useUiLocale } from "@/components/ui-locale-provider";
import { enumLabel, statusLabel } from "@/lib/ui-i18n";

type Option = { id: string; label: string };
type Branch = { id: string; code: string; nameEn: string };
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
}) {
  const router = useRouter();
  const { locale, t } = useUiLocale();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [portalType, setPortalType] = useState("PATIENT");
  const [collectorByVisit, setCollectorByVisit] = useState<Record<string, string>>({});

  async function send(url: string, method: "POST" | "PATCH", payload: unknown, key: string, success: string) {
    setBusy(key);
    setMessage("");
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? success : body.error || t("Action failed.", "تعذر تنفيذ الإجراء."));
    if (response.ok) router.refresh();
    return response.ok;
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
    }, "portal-create", t("Portal account provisioned.", "تم إنشاء حساب البوابة."));
    if (ok) event.currentTarget.reset();
  }

  async function setPortalStatus(accountId: string, status: "ACTIVE" | "DISABLED") {
    if (!window.confirm(status === "DISABLED" ? t("Disable this portal account and revoke active sessions?", "تعطيل حساب البوابة وإلغاء الجلسات النشطة؟") : t("Reactivate this portal account?", "إعادة تفعيل حساب البوابة؟"))) return;
    await send(`/api/portal-accounts/${accountId}/status`, "POST", { status }, "portal-status-" + accountId, status === "DISABLED" ? t("Portal account disabled.", "تم تعطيل حساب البوابة.") : t("Portal account reactivated.", "تمت إعادة تفعيل حساب البوابة."));
  }

  async function setTemporaryPassword(accountId: string) {
    const temporaryPassword = window.prompt(t("Enter a temporary password of at least 12 characters. The portal user will be forced to change it on first login.", "أدخل كلمة مرور مؤقتة من 12 محرفًا على الأقل. سيُطلب من مستخدم البوابة تغييرها عند أول دخول."));
    if (!temporaryPassword) return;
    await send(`/api/portal-accounts/${accountId}/temporary-password`, "POST", { temporaryPassword }, "portal-password-" + accountId, t("Temporary password set and existing portal sessions revoked.", "تم تعيين كلمة المرور المؤقتة وإلغاء جلسات البوابة الحالية."));
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
    }, "corporate-access", t("Corporate portal patient access created.", "تم إنشاء صلاحية المريض لبوابة الشركة."));
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
    }, "appointment-create", t("Appointment created.", "تم إنشاء الموعد."));
    if (ok) event.currentTarget.reset();
  }

  async function changeAppointmentStatus(id: string, status: string) {
    let reason = "";
    if (status === "CANCELLED") {
      reason = window.prompt(t("Cancellation reason:", "سبب الإلغاء:")) || "";
      if (!reason.trim()) return;
    }
    await send(`/api/appointments/${id}/status`, "POST", { status, reason }, "appointment-" + id, t("Appointment updated.", "تم تحديث الموعد."));
  }

  async function updateHomeCollection(item: HomeCollection, status: string) {
    const collectorId = status === "ASSIGNED" ? collectorByVisit[item.id] : undefined;
    if (status === "ASSIGNED" && !collectorId) {
      setMessage(t("Select a collector before assigning the visit.", "اختر موظف سحب قبل تعيين الزيارة."));
      return;
    }
    await send(`/api/home-collections/${item.id}`, "POST", { status, assignedCollectorUserId: collectorId }, "home-" + item.id, t("Home collection updated.", "تم تحديث زيارة السحب المنزلي."));
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
    }, "queue-create", t("Queue ticket issued.", "تم إصدار رقم الانتظار."));
    if (ok) event.currentTarget.reset();
  }

  async function changeQueueStatus(id: string, status: string) {
    const counterLabel = status === "CALLED" ? (window.prompt(t("Counter / station label:", "رقم الشباك / المحطة:"), "") || "") : undefined;
    await send(`/api/queue/${id}/status`, "POST", { status, counterLabel }, "queue-" + id, t("Queue ticket updated.", "تم تحديث رقم الانتظار."));
  }

  const subjects = portalType === "PATIENT" ? patients : portalType === "DOCTOR" ? referrers : clients;

  return <section className="detail-grid detail-section">
    {permissions.portalAccounts && <article className="detail-card">
      <h2>{t("Portal Account", "حساب البوابة")}</h2>
      <form className="catalog-form" onSubmit={createPortalAccount}>
        <label>{t("Type", "النوع")}<select value={portalType} onChange={e => setPortalType(e.target.value)}>
          <option value="PATIENT">{t("Patient", "مريض")}</option>
          <option value="DOCTOR">{t("Doctor", "طبيب")}</option>
          <option value="CORPORATE">{t("Corporate", "شركة")}</option>
        </select></label>
        <label>{t("Subject", "الحساب المرتبط")}<select name="subjectId" required defaultValue=""><option value="">{t("Select…", "اختر…")}</option>{subjects.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{t("Email", "البريد الإلكتروني")}<input name="email" type="email" /></label>
        <label>{t("Phone", "الهاتف")}<input name="phone" /></label>
        <label>{t("Language", "اللغة")}<select name="preferredLocale" defaultValue="en"><option value="en">English</option><option value="ar">العربية</option></select></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "portal-create" ? t("Saving…", "جارٍ الحفظ…") : t("Provision Portal Account", "إنشاء حساب البوابة")}</button>
      </form>
    </article>}


    {permissions.portalAccounts && <article className="detail-card">
      <h2>{t("Corporate Patient Access", "صلاحية مرضى الشركات")}</h2>
      <p className="muted">{t("Explicitly authorize which employees/patients a corporate portal may book for and which reports it may view.", "حدد صراحةً المرضى أو الموظفين الذين يمكن لبوابة الشركة الحجز لهم والتقارير التي يمكنها الاطلاع عليها.")}</p>
      <form className="catalog-form" onSubmit={createCorporateAccess}>
        <label>{t("Corporate client", "عميل الشركة")}<select name="clientId" required defaultValue=""><option value="">{t("Select…", "اختر…")}</option>{clients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{t("Patient", "المريض")}<select name="patientId" required defaultValue=""><option value="">{t("Select…", "اختر…")}</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{t("Employee number", "رقم الموظف")}<input name="employeeNumber" /></label>
        <label>{t("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required /></label>
        <label>{t("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <label><input name="canBook" type="checkbox" defaultChecked /> {t("Can book", "يمكنه الحجز")}</label>
        <label><input name="canViewReports" type="checkbox" /> {t("Can view reports", "يمكنه عرض التقارير")}</label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "corporate-access" ? t("Saving…", "جارٍ الحفظ…") : t("Add Corporate Access", "إضافة صلاحية شركة")}</button>
      </form>
    </article>}

    {permissions.appointments && <article className="detail-card">
      <h2>{t("Create Appointment", "إنشاء موعد")}</h2>
      <form className="catalog-form" onSubmit={createAppointment}>
        <label>{t("Branch", "الفرع")}<select name="branchId" required defaultValue=""><option value="">{t("Select…", "اختر…")}</option>{branches.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
        <label>{t("Patient", "المريض")}<select name="patientId" required defaultValue=""><option value="">{t("Select…", "اختر…")}</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{t("Mode", "نوع الموعد")}<select name="mode" defaultValue="ONSITE"><option value="ONSITE">{t("Onsite", "داخل الفرع")}</option><option value="HOME_COLLECTION">{t("Home collection", "سحب منزلي")}</option></select></label>
        <label>{t("Service code", "رمز الخدمة")}<input name="serviceCode" /></label>
        <label className="form-span">{t("Service name", "اسم الخدمة")}<input name="serviceNameSnapshot" required placeholder={t("Laboratory appointment", "موعد مختبر")} /></label>
        <label>{t("Scheduled start", "موعد البدء")}<input name="scheduledStart" type="datetime-local" required /></label>
        <label>{t("Contact phone", "هاتف التواصل")}<input name="contactPhone" /></label>
        <label className="form-span">{t("Home address", "عنوان المنزل")}<input name="address" /></label>
        <label className="form-span">{t("Notes", "ملاحظات")}<textarea name="notes" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "appointment-create" ? t("Saving…", "جارٍ الحفظ…") : t("Create Appointment", "إنشاء الموعد")}</button>
      </form>
    </article>}

    {permissions.queue && <article className="detail-card">
      <h2>{t("Issue Queue Ticket", "إصدار رقم انتظار")}</h2>
      <form className="catalog-form" onSubmit={issueQueueTicket}>
        <label>{t("Branch", "الفرع")}<select name="branchId" required defaultValue=""><option value="">{t("Select…", "اختر…")}</option>{branches.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
        <label>{t("Patient", "المريض")}<select name="patientId" required defaultValue=""><option value="">{t("Select…", "اختر…")}</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>{t("Appointment", "الموعد")}<select name="appointmentId" defaultValue=""><option value="">{t("Walk-in / none", "زيارة مباشرة / بدون موعد")}</option>{appointments.map(item => <option key={item.id} value={item.id}>{item.appointmentNumber} — {item.patient}</option>)}</select></label>
        <label>{t("Stage", "المرحلة")}<select name="stage" defaultValue="RECEPTION"><option value="RECEPTION">{t("Reception", "الاستقبال")}</option><option value="PHLEBOTOMY">{t("Phlebotomy", "سحب الدم")}</option></select></label>
        <label>{t("Priority", "الأولوية")}<input name="priority" type="number" min="-100" max="100" defaultValue="0" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "queue-create" ? t("Issuing…", "جارٍ الإصدار…") : t("Issue Ticket", "إصدار الرقم")}</button>
      </form>
    </article>}

    {message && <div className="form-success form-span">{message}</div>}

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>{t("Portal Accounts", "حسابات البوابة")}</h2><span>{portalAccounts.length} {t("shown", "ظاهر")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("Type", "النوع")}</th><th>{t("Subject", "الحساب")}</th><th>{t("Contact", "التواصل")}</th><th>{t("Status", "الحالة")}</th><th>{t("First login", "الدخول الأول")}</th><th></th></tr></thead>
        <tbody>{portalAccounts.length === 0 ? <tr><td colSpan={6} className="empty-state">{t("No portal accounts.", "لا توجد حسابات بوابة.")}</td></tr> : portalAccounts.map(item => <tr key={item.id}>
          <td>{enumLabel(locale, item.type)}</td><td>{item.subject}</td><td>{item.contact}</td><td>{statusLabel(locale, item.status)}</td><td>{item.mustChangePassword ? t("Password change required", "مطلوب تغيير كلمة المرور") : t("Complete", "مكتمل")}</td>
          <td>{permissions.portalAccounts && <div className="result-actions">
            <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void setTemporaryPassword(item.id)}>{t("Set temp password", "كلمة مرور مؤقتة")}</button>
            {item.status === "DISABLED"
              ? <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void setPortalStatus(item.id,"ACTIVE")}>{t("Reactivate", "إعادة تفعيل")}</button>
              : <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void setPortalStatus(item.id,"DISABLED")}>{t("Disable", "تعطيل")}</button>}
          </div>}</td>
        </tr>)}</tbody>
      </table></div>
    </article>


    <article className="table-card form-span">
      <div className="table-toolbar"><h2>{t("Corporate Portal Access", "صلاحيات بوابة الشركات")}</h2><span>{corporateAccess.length} {t("shown", "ظاهر")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("Client", "العميل")}</th><th>{t("Patient", "المريض")}</th><th>{t("Employee #", "رقم الموظف")}</th><th>{t("Booking", "الحجز")}</th><th>{t("Reports", "التقارير")}</th><th>{t("Effective", "السريان")}</th><th>{t("Status", "الحالة")}</th></tr></thead>
        <tbody>{corporateAccess.length === 0 ? <tr><td colSpan={7} className="empty-state">{t("No corporate patient access configured.", "لا توجد صلاحيات مرضى شركات مهيأة.")}</td></tr> : corporateAccess.map(item => <tr key={item.id}>
          <td>{item.client}</td><td>{item.patient}</td><td>{item.employeeNumber || "—"}</td><td>{item.canBook ? t("YES", "نعم") : t("NO", "لا")}</td><td>{item.canViewReports ? t("YES", "نعم") : t("NO", "لا")}</td>
          <td>{item.effectiveFrom.slice(0,10)} → {item.effectiveTo?.slice(0,10) || t("Open", "مفتوح")}</td><td>{statusLabel(locale, item.status)}</td>
        </tr>)}</tbody>
      </table></div>
    </article>

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>{t("Appointments", "المواعيد")}</h2><span>{appointments.length} {t("shown", "ظاهر")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("Booking", "الحجز")}</th><th>{t("Patient", "المريض")}</th><th>{t("Branch", "الفرع")}</th><th>{t("Mode", "النوع")}</th><th>{t("Scheduled", "الموعد")}</th><th>{t("Status", "الحالة")}</th><th>{t("Actions", "الإجراءات")}</th></tr></thead>
        <tbody>{appointments.length === 0 ? <tr><td colSpan={7} className="empty-state">{t("No appointments.", "لا توجد مواعيد.")}</td></tr> : appointments.map(item => <tr key={item.id}>
          <td>{item.appointmentNumber}</td><td>{item.patient}</td><td>{item.branch}</td><td>{enumLabel(locale, item.mode)}</td><td>{item.scheduledStart.replace("T"," ").slice(0,16)}</td><td>{statusLabel(locale, item.status)}</td>
          <td className="result-actions">
            {permissions.appointments && item.status === "REQUESTED" && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"CONFIRMED")}>{t("Confirm", "تأكيد")}</button>}
            {permissions.appointments && item.status === "CONFIRMED" && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"CHECKED_IN")}>{t("Check in", "تسجيل حضور")}</button>}
            {permissions.appointments && item.status === "CHECKED_IN" && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"COMPLETED")}>{t("Complete", "إكمال")}</button>}
            {permissions.appointments && !["COMPLETED","CANCELLED","NO_SHOW"].includes(item.status) && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"CANCELLED")}>{t("Cancel", "إلغاء")}</button>}
          </td>
        </tr>)}</tbody>
      </table></div>
    </article>

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>{t("Home Collection", "السحب المنزلي")}</h2><span>{homeCollections.length} {t("shown", "ظاهر")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t("Booking", "الحجز")}</th><th>{t("Patient", "المريض")}</th><th>{t("Branch", "الفرع")}</th><th>{t("Scheduled", "الموعد")}</th><th>{t("Collector", "موظف السحب")}</th><th>{t("Status", "الحالة")}</th><th>{t("Next", "التالي")}</th></tr></thead>
        <tbody>{homeCollections.length === 0 ? <tr><td colSpan={7} className="empty-state">{t("No home collection visits.", "لا توجد زيارات سحب منزلي.")}</td></tr> : homeCollections.map(item => <tr key={item.id}>
          <td>{item.appointmentNumber}</td><td>{item.patient}</td><td>{item.branch}</td><td>{item.scheduledStart.replace("T"," ").slice(0,16)}</td><td>{item.collector || t("Unassigned", "غير معيّن")}</td><td>{statusLabel(locale, item.status)}</td>
          <td>{permissions.homeCollection && <>
            {item.status === "SCHEDULED" && <div className="result-actions">
              <select value={collectorByVisit[item.id] || ""} onChange={event => setCollectorByVisit(current => ({ ...current, [item.id]: event.target.value }))}>
                <option value="">{t("Collector…", "موظف السحب…")}</option>
                {users.map(user => <option key={user.id} value={user.id}>{user.label}</option>)}
              </select>
              <button className="secondary-button" onClick={() => void updateHomeCollection(item,"ASSIGNED")}>{t("Assign", "تعيين")}</button>
            </div>}
            {item.status === "ASSIGNED" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"EN_ROUTE")}>{t("En route", "في الطريق")}</button>}
            {item.status === "EN_ROUTE" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"ARRIVED")}>{t("Arrived", "وصل")}</button>}
            {item.status === "ARRIVED" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"COLLECTING")}>{t("Start collection", "بدء السحب")}</button>}
            {item.status === "COLLECTING" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"COLLECTED")}>{t("Collected", "تم السحب")}</button>}
            {item.status === "COLLECTED" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"DELIVERED")}>{t("Delivered", "تم التسليم")}</button>}
          </>}</td>
        </tr>)}</tbody>
      </table></div>
    </article>

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>{t("Queue", "قائمة الانتظار")}</h2><span>{queueTickets.length} active/recent</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Ticket</th><th>Patient</th><th>Branch</th><th>Stage</th><th>Status</th><th>Counter</th><th>Actions</th></tr></thead>
        <tbody>{queueTickets.length === 0 ? <tr><td colSpan={7} className="empty-state">No queue tickets.</td></tr> : queueTickets.map(item => <tr key={item.id}>
          <td><strong>{item.ticketNumber}</strong></td><td>{item.patient}</td><td>{item.branch}</td><td>{item.stage}</td><td>{statusLabel(locale, item.status)}</td><td>{item.counterLabel || "—"}</td>
          <td className="result-actions">{permissions.queue && <>
            {item.status === "WAITING" && <button className="secondary-button" onClick={() => void changeQueueStatus(item.id,"CALLED")}>Call</button>}
            {item.status === "CALLED" && <button className="secondary-button" onClick={() => void changeQueueStatus(item.id,"SERVING")}>Start</button>}
            {item.status === "SERVING" && <button className="secondary-button" onClick={() => void changeQueueStatus(item.id,"COMPLETED")}>{t("Complete", "إكمال")}</button>}
          </>}</td>
        </tr>)}</tbody>
      </table></div>
    </article>
  </section>;
}
