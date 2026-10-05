"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string };
type Department = { id: string; code: string; nameEn: string; branchId: string | null };
type Analyzer = { id: string; code: string; name: string; branchId: string; departmentId: string | null };
type EquipmentOption = {
  id: string;
  assetId: string;
  name: string;
  status: string;
  analyzerId: string | null;
  maintenancePlans: Array<{ id: string; name: string; nextDueAt: string }>;
};

export function EquipmentManager({
  branches,
  departments,
  analyzers,
  equipment,
  canManage,
}: {
  branches: Branch[];
  departments: Department[];
  analyzers: Analyzer[];
  equipment: EquipmentOption[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function submit(url: string, payload: unknown, key: string, success: string, form: HTMLFormElement) {
    setBusy(key);
    setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? success : body.error || "Action failed.");
    if (response.ok) {
      form.reset();
      router.refresh();
    }
  }

  async function createEquipment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("/api/equipment", {
      branchId,
      departmentId: form.get("departmentId"),
      analyzerId: form.get("analyzerId"),
      assetId: form.get("assetId"),
      name: form.get("name"),
      manufacturer: form.get("manufacturer"),
      model: form.get("model"),
      serialNumber: form.get("serialNumber"),
      installationDate: form.get("installationDate"),
      warrantyUntil: form.get("warrantyUntil"),
      serviceVendor: form.get("serviceVendor"),
      locationText: form.get("locationText"),
      notes: form.get("notes"),
    }, "equipment", "Equipment registered.", event.currentTarget);
    setBranchId("");
  }

  async function maintenance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const equipmentId = String(form.get("equipmentId") || "");
    await submit(`/api/equipment/${equipmentId}/maintenance`, {
      maintenanceType: form.get("maintenanceType"),
      maintenancePlanId: form.get("maintenancePlanId"),
      status: form.get("status"),
      scheduledAt: form.get("scheduledAt"),
      startedAt: form.get("startedAt"),
      completedAt: form.get("completedAt"),
      vendorEngineer: form.get("vendorEngineer"),
      workPerformed: form.get("workPerformed"),
      correctiveAction: form.get("correctiveAction"),
      cost: form.get("cost"),
      currency: form.get("currency"),
    }, "maintenance", "Maintenance event recorded.", event.currentTarget);
  }

  async function calibration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const equipmentId = String(form.get("equipmentId") || "");
    await submit(`/api/equipment/${equipmentId}/calibrations`, {
      status: form.get("status"),
      materialName: form.get("materialName"),
      materialLot: form.get("materialLot"),
      dueAt: form.get("dueAt"),
      performedAt: form.get("performedAt"),
      resultSummary: form.get("resultSummary"),
      approve: form.get("approve") === "on",
    }, "calibration", "Calibration event recorded.", event.currentTarget);
  }

  async function downtime(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const equipmentId = String(form.get("equipmentId") || "");
    const action = String(form.get("action") || "");
    await submit(`/api/equipment/${equipmentId}/downtime`, {
      action,
      reason: form.get("reason"),
      impact: form.get("impact"),
      resolution: form.get("resolution"),
    }, "downtime", action === "OPEN" ? "Downtime opened." : "Downtime closed.", event.currentTarget);
  }

  async function maintenancePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const equipmentId = String(form.get("equipmentId") || "");
    await submit(`/api/equipment/${equipmentId}/maintenance-plans`, {
      name: form.get("name"),
      frequencyDays: form.get("frequencyDays"),
      nextDueAt: form.get("nextDueAt"),
      instructions: form.get("instructions"),
    }, "maintenance-plan", "Maintenance plan created.", event.currentTarget);
  }

  async function equipmentDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const equipmentId = String(form.get("equipmentId") || "");
    await submit(`/api/equipment/${equipmentId}/documents`, {
      documentType: form.get("documentType"),
      name: form.get("name"),
      externalUrl: form.get("externalUrl"),
      expiresAt: form.get("expiresAt"),
      notes: form.get("notes"),
    }, "document", "Equipment document recorded.", event.currentTarget);
  }

  if (!canManage) return null;

  const equipmentOptions = equipment.filter(item => item.status !== "RETIRED");

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>Register Equipment</h2>
      <form className="catalog-form" onSubmit={createEquipment}>
        <label>Branch<select required value={branchId} onChange={event => setBranchId(event.target.value)}>
          <option value="">Select branch…</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
        </select></label>
        <label>Department<select name="departmentId" defaultValue=""><option value="">Unassigned</option>{departments.filter(item => !item.branchId || item.branchId === branchId).map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
        <label>Analyzer link<select name="analyzerId" defaultValue=""><option value="">Not an analyzer</option>{analyzers.filter(item => item.branchId === branchId).map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>Asset ID<input name="assetId" required /></label>
        <label>Name<input name="name" required /></label>
        <label>Manufacturer<input name="manufacturer" /></label>
        <label>Model<input name="model" /></label>
        <label>Serial number<input name="serialNumber" /></label>
        <label>Installation date<input name="installationDate" type="date" /></label>
        <label>Warranty until<input name="warrantyUntil" type="date" /></label>
        <label>Service vendor<input name="serviceVendor" /></label>
        <label>Location<input name="locationText" /></label>
        <label className="form-span">Notes<textarea name="notes" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "equipment" ? "Saving…" : "Register Equipment"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Maintenance Event</h2>
      <form className="catalog-form" onSubmit={maintenance}>
        <label className="form-span">Equipment<select name="equipmentId" required defaultValue=""><option value="">Select equipment…</option>{equipmentOptions.map(item => <option key={item.id} value={item.id}>{item.assetId} — {item.name}</option>)}</select></label>
        <label>Type<select name="maintenanceType" defaultValue="PREVENTIVE"><option value="PREVENTIVE">Preventive</option><option value="CORRECTIVE">Corrective</option></select></label>
        <label>Plan<select name="maintenancePlanId" defaultValue="">
          <option value="">Ad-hoc maintenance</option>
          {equipmentOptions.flatMap(item => item.maintenancePlans.map(plan => <option key={plan.id} value={plan.id}>{item.assetId} · {plan.name} · due {plan.nextDueAt}</option>))}
        </select></label>
        <label>Status<select name="status" defaultValue="COMPLETED"><option value="SCHEDULED">Scheduled</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option></select></label>
        <label>Scheduled<input name="scheduledAt" type="datetime-local" /></label>
        <label>Started<input name="startedAt" type="datetime-local" /></label>
        <label>Completed<input name="completedAt" type="datetime-local" /></label>
        <label>Vendor engineer<input name="vendorEngineer" /></label>
        <label>Cost<input name="cost" type="number" min="0" step="0.0001" /></label>
        <label>Currency<input name="currency" maxLength={3} defaultValue="AED" /></label>
        <label className="form-span">Work performed<textarea name="workPerformed" rows={2} /></label>
        <label className="form-span">Corrective action<textarea name="correctiveAction" rows={2} /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "maintenance" ? "Saving…" : "Record Maintenance"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Calibration</h2>
      <form className="catalog-form" onSubmit={calibration}>
        <label className="form-span">Equipment<select name="equipmentId" required defaultValue=""><option value="">Select equipment…</option>{equipmentOptions.map(item => <option key={item.id} value={item.id}>{item.assetId} — {item.name}</option>)}</select></label>
        <label>Status<select name="status" defaultValue="PASS"><option value="DUE">Due</option><option value="IN_PROGRESS">In progress</option><option value="PASS">Pass</option><option value="FAIL">Fail</option></select></label>
        <label>Due date<input name="dueAt" type="date" /></label>
        <label>Performed at<input name="performedAt" type="datetime-local" /></label>
        <label>Material<input name="materialName" /></label>
        <label>Material lot<input name="materialLot" /></label>
        <label className="check-line"><input name="approve" type="checkbox" /> Approve passing calibration</label>
        <label className="form-span">Result summary<textarea name="resultSummary" rows={2} /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "calibration" ? "Saving…" : "Record Calibration"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Downtime</h2>
      <form className="catalog-form" onSubmit={downtime}>
        <label className="form-span">Equipment<select name="equipmentId" required defaultValue=""><option value="">Select equipment…</option>{equipmentOptions.map(item => <option key={item.id} value={item.id}>{item.assetId} — {item.name}</option>)}</select></label>
        <label>Action<select name="action" defaultValue="OPEN"><option value="OPEN">Open downtime</option><option value="CLOSE">Close downtime</option></select></label>
        <label className="form-span">Reason<input name="reason" /></label>
        <label className="form-span">Impact<input name="impact" /></label>
        <label className="form-span">Resolution<input name="resolution" /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "downtime" ? "Saving…" : "Update Downtime"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Preventive Maintenance Plan</h2>
      <form className="catalog-form" onSubmit={maintenancePlan}>
        <label className="form-span">Equipment<select name="equipmentId" required defaultValue=""><option value="">Select equipment…</option>{equipmentOptions.map(item => <option key={item.id} value={item.id}>{item.assetId} — {item.name}</option>)}</select></label>
        <label>Plan name<input name="name" required placeholder="Monthly preventive service" /></label>
        <label>Frequency (days)<input name="frequencyDays" type="number" min="1" max="3650" required /></label>
        <label>Next due<input name="nextDueAt" type="date" required /></label>
        <label className="form-span">Instructions<textarea name="instructions" rows={2} /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "maintenance-plan" ? "Saving…" : "Create Maintenance Plan"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Equipment Document</h2>
      <p className="muted">Record a controlled document or attachment reference. File-storage upload can use the storage-key field through the API when a storage provider is connected.</p>
      <form className="catalog-form" onSubmit={equipmentDocument}>
        <label className="form-span">Equipment<select name="equipmentId" required defaultValue=""><option value="">Select equipment…</option>{equipmentOptions.map(item => <option key={item.id} value={item.id}>{item.assetId} — {item.name}</option>)}</select></label>
        <label>Document type<input name="documentType" required placeholder="MANUAL / CERTIFICATE / SERVICE_REPORT" /></label>
        <label>Name<input name="name" required /></label>
        <label className="form-span">External URL<input name="externalUrl" type="url" required placeholder="https://…" /></label>
        <label>Expiry<input name="expiresAt" type="date" /></label>
        <label className="form-span">Notes<textarea name="notes" rows={2} /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "document" ? "Saving…" : "Record Document"}</button>
      </form>
    </article>

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
