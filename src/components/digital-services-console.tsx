"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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
    setMessage(response.ok ? success : body.error || "Action failed.");
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
    }, "portal-create", "Portal account provisioned.");
    if (ok) event.currentTarget.reset();
  }

  async function setPortalStatus(accountId: string, status: "ACTIVE" | "DISABLED") {
    if (!window.confirm(status === "DISABLED" ? "Disable this portal account and revoke active sessions?" : "Reactivate this portal account?")) return;
    await send(`/api/portal-accounts/${accountId}/status`, "POST", { status }, "portal-status-" + accountId, status === "DISABLED" ? "Portal account disabled." : "Portal account reactivated.");
  }

  async function setTemporaryPassword(accountId: string) {
    const temporaryPassword = window.prompt("Enter a temporary password of at least 12 characters. The portal user will be forced to change it on first login.");
    if (!temporaryPassword) return;
    await send(`/api/portal-accounts/${accountId}/temporary-password`, "POST", { temporaryPassword }, "portal-password-" + accountId, "Temporary password set and existing portal sessions revoked.");
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
    }, "corporate-access", "Corporate portal patient access created.");
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
    }, "appointment-create", "Appointment created.");
    if (ok) event.currentTarget.reset();
  }

  async function changeAppointmentStatus(id: string, status: string) {
    let reason = "";
    if (status === "CANCELLED") {
      reason = window.prompt("Cancellation reason:") || "";
      if (!reason.trim()) return;
    }
    await send(`/api/appointments/${id}/status`, "POST", { status, reason }, "appointment-" + id, "Appointment updated.");
  }

  async function updateHomeCollection(item: HomeCollection, status: string) {
    const collectorId = status === "ASSIGNED" ? collectorByVisit[item.id] : undefined;
    if (status === "ASSIGNED" && !collectorId) {
      setMessage("Select a collector before assigning the visit.");
      return;
    }
    await send(`/api/home-collections/${item.id}`, "POST", { status, assignedCollectorUserId: collectorId }, "home-" + item.id, "Home collection updated.");
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
    }, "queue-create", "Queue ticket issued.");
    if (ok) event.currentTarget.reset();
  }

  async function changeQueueStatus(id: string, status: string) {
    const counterLabel = status === "CALLED" ? (window.prompt("Counter / station label:", "") || "") : undefined;
    await send(`/api/queue/${id}/status`, "POST", { status, counterLabel }, "queue-" + id, "Queue ticket updated.");
  }

  const subjects = portalType === "PATIENT" ? patients : portalType === "DOCTOR" ? referrers : clients;

  return <section className="detail-grid detail-section">
    {permissions.portalAccounts && <article className="detail-card">
      <h2>Portal Account</h2>
      <form className="catalog-form" onSubmit={createPortalAccount}>
        <label>Type<select value={portalType} onChange={e => setPortalType(e.target.value)}>
          <option value="PATIENT">Patient</option>
          <option value="DOCTOR">Doctor</option>
          <option value="CORPORATE">Corporate</option>
        </select></label>
        <label>Subject<select name="subjectId" required defaultValue=""><option value="">Select…</option>{subjects.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Email<input name="email" type="email" /></label>
        <label>Phone<input name="phone" /></label>
        <label>Language<select name="preferredLocale" defaultValue="en"><option value="en">English</option><option value="ar">العربية</option></select></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "portal-create" ? "Saving…" : "Provision Portal Account"}</button>
      </form>
    </article>}


    {permissions.portalAccounts && <article className="detail-card">
      <h2>Corporate Patient Access</h2>
      <p className="muted">Explicitly authorize which employees/patients a corporate portal may book for and which reports it may view.</p>
      <form className="catalog-form" onSubmit={createCorporateAccess}>
        <label>Corporate client<select name="clientId" required defaultValue=""><option value="">Select…</option>{clients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Patient<select name="patientId" required defaultValue=""><option value="">Select…</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Employee number<input name="employeeNumber" /></label>
        <label>Effective from<input name="effectiveFrom" type="date" required /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <label><input name="canBook" type="checkbox" defaultChecked /> Can book</label>
        <label><input name="canViewReports" type="checkbox" /> Can view reports</label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "corporate-access" ? "Saving…" : "Add Corporate Access"}</button>
      </form>
    </article>}

    {permissions.appointments && <article className="detail-card">
      <h2>Create Appointment</h2>
      <form className="catalog-form" onSubmit={createAppointment}>
        <label>Branch<select name="branchId" required defaultValue=""><option value="">Select…</option>{branches.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
        <label>Patient<select name="patientId" required defaultValue=""><option value="">Select…</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Mode<select name="mode" defaultValue="ONSITE"><option value="ONSITE">Onsite</option><option value="HOME_COLLECTION">Home collection</option></select></label>
        <label>Service code<input name="serviceCode" /></label>
        <label className="form-span">Service name<input name="serviceNameSnapshot" required placeholder="Laboratory appointment" /></label>
        <label>Scheduled start<input name="scheduledStart" type="datetime-local" required /></label>
        <label>Contact phone<input name="contactPhone" /></label>
        <label className="form-span">Home address<input name="address" /></label>
        <label className="form-span">Notes<textarea name="notes" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "appointment-create" ? "Saving…" : "Create Appointment"}</button>
      </form>
    </article>}

    {permissions.queue && <article className="detail-card">
      <h2>Issue Queue Ticket</h2>
      <form className="catalog-form" onSubmit={issueQueueTicket}>
        <label>Branch<select name="branchId" required defaultValue=""><option value="">Select…</option>{branches.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
        <label>Patient<select name="patientId" required defaultValue=""><option value="">Select…</option>{patients.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Appointment<select name="appointmentId" defaultValue=""><option value="">Walk-in / none</option>{appointments.map(item => <option key={item.id} value={item.id}>{item.appointmentNumber} — {item.patient}</option>)}</select></label>
        <label>Stage<select name="stage" defaultValue="RECEPTION"><option value="RECEPTION">Reception</option><option value="PHLEBOTOMY">Phlebotomy</option></select></label>
        <label>Priority<input name="priority" type="number" min="-100" max="100" defaultValue="0" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "queue-create" ? "Issuing…" : "Issue Ticket"}</button>
      </form>
    </article>}

    {message && <div className="form-success form-span">{message}</div>}

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>Portal Accounts</h2><span>{portalAccounts.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Type</th><th>Subject</th><th>Contact</th><th>Status</th><th>First login</th><th></th></tr></thead>
        <tbody>{portalAccounts.length === 0 ? <tr><td colSpan={6} className="empty-state">No portal accounts.</td></tr> : portalAccounts.map(item => <tr key={item.id}>
          <td>{item.type}</td><td>{item.subject}</td><td>{item.contact}</td><td>{item.status}</td><td>{item.mustChangePassword ? "Password change required" : "Complete"}</td>
          <td>{permissions.portalAccounts && <div className="result-actions">
            <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void setTemporaryPassword(item.id)}>Set temp password</button>
            {item.status === "DISABLED"
              ? <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void setPortalStatus(item.id,"ACTIVE")}>Reactivate</button>
              : <button className="secondary-button" type="button" disabled={busy !== ""} onClick={() => void setPortalStatus(item.id,"DISABLED")}>Disable</button>}
          </div>}</td>
        </tr>)}</tbody>
      </table></div>
    </article>


    <article className="table-card form-span">
      <div className="table-toolbar"><h2>Corporate Portal Access</h2><span>{corporateAccess.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Client</th><th>Patient</th><th>Employee #</th><th>Booking</th><th>Reports</th><th>Effective</th><th>Status</th></tr></thead>
        <tbody>{corporateAccess.length === 0 ? <tr><td colSpan={7} className="empty-state">No corporate patient access configured.</td></tr> : corporateAccess.map(item => <tr key={item.id}>
          <td>{item.client}</td><td>{item.patient}</td><td>{item.employeeNumber || "—"}</td><td>{item.canBook ? "YES" : "NO"}</td><td>{item.canViewReports ? "YES" : "NO"}</td>
          <td>{item.effectiveFrom.slice(0,10)} → {item.effectiveTo?.slice(0,10) || "Open"}</td><td>{item.status}</td>
        </tr>)}</tbody>
      </table></div>
    </article>

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>Appointments</h2><span>{appointments.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Booking</th><th>Patient</th><th>Branch</th><th>Mode</th><th>Scheduled</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>{appointments.length === 0 ? <tr><td colSpan={7} className="empty-state">No appointments.</td></tr> : appointments.map(item => <tr key={item.id}>
          <td>{item.appointmentNumber}</td><td>{item.patient}</td><td>{item.branch}</td><td>{item.mode}</td><td>{item.scheduledStart.replace("T"," ").slice(0,16)}</td><td>{item.status}</td>
          <td className="result-actions">
            {permissions.appointments && item.status === "REQUESTED" && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"CONFIRMED")}>Confirm</button>}
            {permissions.appointments && item.status === "CONFIRMED" && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"CHECKED_IN")}>Check in</button>}
            {permissions.appointments && item.status === "CHECKED_IN" && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"COMPLETED")}>Complete</button>}
            {permissions.appointments && !["COMPLETED","CANCELLED","NO_SHOW"].includes(item.status) && <button className="secondary-button" onClick={() => void changeAppointmentStatus(item.id,"CANCELLED")}>Cancel</button>}
          </td>
        </tr>)}</tbody>
      </table></div>
    </article>

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>Home Collection</h2><span>{homeCollections.length} shown</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Booking</th><th>Patient</th><th>Branch</th><th>Scheduled</th><th>Collector</th><th>Status</th><th>Next</th></tr></thead>
        <tbody>{homeCollections.length === 0 ? <tr><td colSpan={7} className="empty-state">No home collection visits.</td></tr> : homeCollections.map(item => <tr key={item.id}>
          <td>{item.appointmentNumber}</td><td>{item.patient}</td><td>{item.branch}</td><td>{item.scheduledStart.replace("T"," ").slice(0,16)}</td><td>{item.collector || "Unassigned"}</td><td>{item.status}</td>
          <td>{permissions.homeCollection && <>
            {item.status === "SCHEDULED" && <div className="result-actions">
              <select value={collectorByVisit[item.id] || ""} onChange={event => setCollectorByVisit(current => ({ ...current, [item.id]: event.target.value }))}>
                <option value="">Collector…</option>
                {users.map(user => <option key={user.id} value={user.id}>{user.label}</option>)}
              </select>
              <button className="secondary-button" onClick={() => void updateHomeCollection(item,"ASSIGNED")}>Assign</button>
            </div>}
            {item.status === "ASSIGNED" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"EN_ROUTE")}>En route</button>}
            {item.status === "EN_ROUTE" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"ARRIVED")}>Arrived</button>}
            {item.status === "ARRIVED" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"COLLECTING")}>Start collection</button>}
            {item.status === "COLLECTING" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"COLLECTED")}>Collected</button>}
            {item.status === "COLLECTED" && <button className="secondary-button" onClick={() => void updateHomeCollection(item,"DELIVERED")}>Delivered</button>}
          </>}</td>
        </tr>)}</tbody>
      </table></div>
    </article>

    <article className="table-card form-span">
      <div className="table-toolbar"><h2>Queue</h2><span>{queueTickets.length} active/recent</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Ticket</th><th>Patient</th><th>Branch</th><th>Stage</th><th>Status</th><th>Counter</th><th>Actions</th></tr></thead>
        <tbody>{queueTickets.length === 0 ? <tr><td colSpan={7} className="empty-state">No queue tickets.</td></tr> : queueTickets.map(item => <tr key={item.id}>
          <td><strong>{item.ticketNumber}</strong></td><td>{item.patient}</td><td>{item.branch}</td><td>{item.stage}</td><td>{item.status}</td><td>{item.counterLabel || "—"}</td>
          <td className="result-actions">{permissions.queue && <>
            {item.status === "WAITING" && <button className="secondary-button" onClick={() => void changeQueueStatus(item.id,"CALLED")}>Call</button>}
            {item.status === "CALLED" && <button className="secondary-button" onClick={() => void changeQueueStatus(item.id,"SERVING")}>Start</button>}
            {item.status === "SERVING" && <button className="secondary-button" onClick={() => void changeQueueStatus(item.id,"COMPLETED")}>Complete</button>}
          </>}</td>
        </tr>)}</tbody>
      </table></div>
    </article>
  </section>;
}
