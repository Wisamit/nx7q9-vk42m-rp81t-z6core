"use client";

import { SystemDateField } from "@/components/system-date-field";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Department = { id: string; code: string; nameEn: string; nameAr?: string | null; branchId: string | null };
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
  locale,
}: {
  branches: Branch[];
  departments: Department[];
  analyzers: Analyzer[];
  equipment: EquipmentOption[];
  canManage: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [uiEditor, setUiEditor] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const maintenanceTypeLabel = (value: string) =>
    value === "PREVENTIVE" ? tr("Preventive", "وقائية") :
    value === "CORRECTIVE" ? tr("Corrective", "تصحيحية") : value;
  const eventStatusLabel = (value: string) =>
    value === "SCHEDULED" ? tr("Scheduled", "مجدول") :
    value === "IN_PROGRESS" ? tr("In progress", "قيد التنفيذ") :
    value === "COMPLETED" ? tr("Completed", "مكتمل") :
    value === "DUE" ? tr("Due", "مستحق") :
    value === "PASS" ? tr("Pass", "ناجح") :
    value === "FAIL" ? tr("Fail", "فشل") :
    value === "OPEN" ? tr("Open", "فتح") :
    value === "CLOSE" ? tr("Close", "إغلاق") :
    value;

  async function submit(url: string, payload: unknown, key: string, success: string, form: HTMLFormElement) {
    setBusy(key);
    setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? success : tr("Action failed.", "فشلت العملية."));
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
    }, "equipment", tr("Equipment registered.", "تم تسجيل المعدة."), event.currentTarget);
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
    }, "maintenance", tr("Maintenance event recorded.", "تم تسجيل حدث الصيانة."), event.currentTarget);
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
    }, "calibration", tr("Calibration event recorded.", "تم تسجيل حدث المعايرة."), event.currentTarget);
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
    }, "downtime", action === "OPEN"
      ? tr("Downtime opened.", "تم فتح حدث توقف.")
      : action === "CLOSE"
        ? tr("Downtime closed. Equipment remains out of service until authorized restoration.", "تم إغلاق التوقف. تبقى المعدة خارج الخدمة حتى إعادة تفعيلها بشكل معتمد.")
        : tr("Equipment returned to service.", "تمت إعادة المعدة إلى الخدمة."), event.currentTarget);
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
    }, "maintenance-plan", tr("Maintenance plan created.", "تم إنشاء خطة الصيانة."), event.currentTarget);
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
    }, "document", tr("Equipment document recorded.", "تم تسجيل وثيقة المعدة."), event.currentTarget);
  }

  if (!canManage) return null;

  const equipmentOptions = equipment.filter(item => item.status !== "RETIRED");

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>{tr("Register Equipment", "تسجيل معدة")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={() => { setMessage(""); setUiEditor("equipment"); }}>
    {tr("Register Equipment", "تسجيل معدة")}
  </button>
  <CrudModal open={uiEditor === "equipment"} onClose={() => { if (!busy) setUiEditor(""); }}
    size="compact"
    title={tr("Register Equipment", "تسجيل معدة")}
    description={tr("Equipment belongs to a branch and keeps its immutable identity.", "المعدة مرتبطة بفرع ولها هوية ثابتة.")}>
    {uiEditor === "equipment" && <form className="catalog-form" onSubmit={createEquipment}>
        <label>{tr("Branch", "الفرع")}<select required value={branchId} onChange={event => setBranchId(event.target.value)}>
          <option value="">{tr("Select branch…", "اختر الفرع…")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}
        </select></label>
        <label>{tr("Department", "القسم")}<select name="departmentId" defaultValue=""><option value="">{tr("Unassigned", "غير معين")}</option>{departments.filter(item => !item.branchId || item.branchId === branchId).map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}</select></label>
        <label>{tr("Analyzer link", "ربط جهاز التحليل")}<select name="analyzerId" defaultValue=""><option value="">{tr("Not an analyzer", "ليست مرتبطة بجهاز تحليل")}</option>{analyzers.filter(item => item.branchId === branchId).map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
        <label>{tr("Asset ID", "معرّف الأصل")}<input name="assetId" required /></label>
        <label>{tr("Name", "الاسم")}<input name="name" required /></label>
        <label>{tr("Manufacturer", "الشركة المصنعة")}<input name="manufacturer" /></label>
        <label>{tr("Model", "الطراز")}<input name="model" /></label>
        <label>{tr("Serial number", "الرقم التسلسلي")}<input name="serialNumber" /></label>
        <label>{tr("Installation date", "تاريخ التركيب")}<SystemDateField name="installationDate" /></label>
        <label>{tr("Warranty until", "الضمان حتى")}<SystemDateField name="warrantyUntil" /></label>
        <label>{tr("Service vendor", "مزود الصيانة")}<input name="serviceVendor" /></label>
        <label>{tr("Location", "الموقع")}<input name="locationText" /></label>
        <label className="form-span">{tr("Notes", "ملاحظات")}<textarea name="notes" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "equipment" ? tr("Saving…", "جارٍ الحفظ…") : tr("Register Equipment", "تسجيل المعدة")}</button>
      </form>}
    {uiEditor === "equipment" && message && <p className="form-warning" role="status">{message}</p>}
  </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Maintenance Event", "حدث صيانة")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={() => { setMessage(""); setUiEditor("maintenance"); }}>
    {tr("Record Maintenance", "تسجيل صيانة")}
  </button>
  <CrudModal open={uiEditor === "maintenance"} onClose={() => { if (!busy) setUiEditor(""); }}
    size="compact"
    title={tr("Record Maintenance", "تسجيل صيانة")}
    description={tr("Records an equipment maintenance event; previous history is preserved.", "يسجل حدث صيانة دون حذف التاريخ السابق.")}>
    {uiEditor === "maintenance" && <form className="catalog-form" onSubmit={maintenance}>
        <label className="form-span">{tr("Equipment", "المعدة")}<select name="equipmentId" required defaultValue=""><option value="">{tr("Select equipment…", "اختر المعدة…")}</option>{equipmentOptions.map(item => <option key={item.id} value={item.id}>{item.assetId} — {item.name}</option>)}</select></label>
        <label>{tr("Type", "النوع")}<select name="maintenanceType" defaultValue="PREVENTIVE"><option value="PREVENTIVE">{maintenanceTypeLabel("PREVENTIVE")}</option><option value="CORRECTIVE">{maintenanceTypeLabel("CORRECTIVE")}</option></select></label>
        <label>{tr("Plan", "الخطة")}<select name="maintenancePlanId" defaultValue="">
          <option value="">{tr("Ad-hoc maintenance", "صيانة غير مجدولة")}</option>
          {equipmentOptions.flatMap(item => item.maintenancePlans.map(plan => <option key={plan.id} value={plan.id}>{item.assetId} · {plan.name} · {tr("due", "مستحق")} {plan.nextDueAt}</option>))}
        </select></label>
        <label>{tr("Status", "الحالة")}<select name="status" defaultValue="COMPLETED"><option value="SCHEDULED">{eventStatusLabel("SCHEDULED")}</option><option value="IN_PROGRESS">{eventStatusLabel("IN_PROGRESS")}</option><option value="COMPLETED">{eventStatusLabel("COMPLETED")}</option></select></label>
        <label>{tr("Scheduled", "المجدول")}<input name="scheduledAt" type="datetime-local" /></label>
        <label>{tr("Started", "وقت البدء")}<input name="startedAt" type="datetime-local" /></label>
        <label>{tr("Completed", "وقت الاكتمال")}<input name="completedAt" type="datetime-local" /></label>
        <label>{tr("Vendor engineer", "فني/مهندس المورد")}<input name="vendorEngineer" /></label>
        <label>{tr("Cost", "التكلفة")}<input name="cost" type="number" min="0" step="0.0001" /></label>
        <label>{tr("Currency", "العملة")}<input name="currency" maxLength={3} defaultValue="AED" /></label>
        <label className="form-span">{tr("Work performed", "العمل المنفذ")}<textarea name="workPerformed" rows={2} /></label>
        <label className="form-span">{tr("Corrective action", "الإجراء التصحيحي")}<textarea name="correctiveAction" rows={2} /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "maintenance" ? tr("Saving…", "جارٍ الحفظ…") : tr("Record Maintenance", "تسجيل الصيانة")}</button>
      </form>}
    {uiEditor === "maintenance" && message && <p className="form-warning" role="status">{message}</p>}
  </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Calibration", "المعايرة")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={() => { setMessage(""); setUiEditor("calibration"); }}>
    {tr("Record Calibration", "تسجيل معايرة")}
  </button>
  <CrudModal open={uiEditor === "calibration"} onClose={() => { if (!busy) setUiEditor(""); }}
    size="compact"
    title={tr("Record Calibration", "تسجيل معايرة")}
    description={tr("Record measured calibration evidence only; no invented QC limits.", "سجّل أدلة المعايرة المقاسة فقط، دون اختراع حدود ضبط جودة.")}>
    {uiEditor === "calibration" && <form className="catalog-form" onSubmit={calibration}>
        <label className="form-span">{tr("Equipment", "المعدة")}<select name="equipmentId" required defaultValue=""><option value="">{tr("Select equipment…", "اختر المعدة…")}</option>{equipmentOptions.map(item => <option key={item.id} value={item.id}>{item.assetId} — {item.name}</option>)}</select></label>
        <label>{tr("Status", "الحالة")}<select name="status" defaultValue="PASS"><option value="DUE">{eventStatusLabel("DUE")}</option><option value="IN_PROGRESS">{eventStatusLabel("IN_PROGRESS")}</option><option value="PASS">{eventStatusLabel("PASS")}</option><option value="FAIL">{eventStatusLabel("FAIL")}</option></select></label>
        <label>{tr("Due date", "تاريخ الاستحقاق")}<SystemDateField name="dueAt" /></label>
        <label>{tr("Performed at", "وقت التنفيذ")}<input name="performedAt" type="datetime-local" /></label>
        <label>{tr("Material", "المادة")}<input name="materialName" /></label>
        <label>{tr("Material lot", "تشغيلة المادة")}<input name="materialLot" /></label>
        <label className="check-line"><input name="approve" type="checkbox" /> {tr("Approve passing calibration", "اعتماد المعايرة الناجحة")}</label>
        <label className="form-span">{tr("Result summary", "ملخص النتيجة")}<textarea name="resultSummary" rows={2} /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "calibration" ? tr("Saving…", "جارٍ الحفظ…") : tr("Record Calibration", "تسجيل المعايرة")}</button>
      </form>}
    {uiEditor === "calibration" && message && <p className="form-warning" role="status">{message}</p>}
  </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Downtime", "التوقف")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={() => { setMessage(""); setUiEditor("downtime"); }}>
    {tr("Update Equipment Downtime", "تحديث توقف المعدة")}
  </button>
  <CrudModal open={uiEditor === "downtime"} onClose={() => { if (!busy) setUiEditor(""); }}
    size="compact"
    title={tr("Update Equipment Downtime", "تحديث توقف المعدة")}
    description={tr("Downtime affects analyzer/equipment readiness. Review actual downtime periods.", "يؤثر التوقف على جاهزية الأجهزة، لذا راجع المدة الفعلية.")}>
    {uiEditor === "downtime" && <form className="catalog-form" onSubmit={downtime}>
        <label className="form-span">{tr("Equipment", "المعدة")}<select name="equipmentId" required defaultValue=""><option value="">{tr("Select equipment…", "اختر المعدة…")}</option>{equipmentOptions.map(item => <option key={item.id} value={item.id}>{item.assetId} — {item.name}</option>)}</select></label>
        <label>{tr("Action", "الإجراء")}<select name="action" defaultValue="OPEN"><option value="OPEN">{tr("Open downtime", "فتح توقف")}</option><option value="CLOSE">{tr("Close downtime", "إغلاق التوقف")}</option><option value="RESTORE">{tr("Return to service (after clearance)", "إعادة للخدمة بعد استيفاء الشروط")}</option></select></label>
        <label className="form-span">{tr("Reason", "السبب")}<input name="reason" /></label>
        <label className="form-span">{tr("Impact", "التأثير")}<input name="impact" /></label>
        <label className="form-span">{tr("Resolution", "الحل")}<input name="resolution" /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "downtime" ? tr("Saving…", "جارٍ الحفظ…") : tr("Update Downtime", "تحديث التوقف")}</button>
      </form>}
    {uiEditor === "downtime" && message && <p className="form-warning" role="status">{message}</p>}
  </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Preventive Maintenance Plan", "خطة الصيانة الوقائية")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={() => { setMessage(""); setUiEditor("plan"); }}>
    {tr("Manage Maintenance Plan", "إدارة خطة الصيانة")}
  </button>
  <CrudModal open={uiEditor === "plan"} onClose={() => { if (!busy) setUiEditor(""); }}
    size="compact"
    title={tr("Manage Maintenance Plan", "إدارة خطة الصيانة")}
    description={tr("Schedule governed preventive maintenance for the selected equipment.", "جدولة الصيانة الوقائية الموثقة للمعدة المحددة.")}>
    {uiEditor === "plan" && <form className="catalog-form" onSubmit={maintenancePlan}>
        <label className="form-span">{tr("Equipment", "المعدة")}<select name="equipmentId" required defaultValue=""><option value="">{tr("Select equipment…", "اختر المعدة…")}</option>{equipmentOptions.map(item => <option key={item.id} value={item.id}>{item.assetId} — {item.name}</option>)}</select></label>
        <label>{tr("Plan name", "اسم الخطة")}<input name="name" required placeholder={tr("Monthly preventive service", "صيانة وقائية شهرية")} /></label>
        <label>{tr("Frequency (days)", "التكرار (أيام)")}<input name="frequencyDays" type="number" min="1" max="3650" required /></label>
        <label>{tr("Next due", "الاستحقاق التالي")}<SystemDateField name="nextDueAt" required /></label>
        <label className="form-span">{tr("Instructions", "التعليمات")}<textarea name="instructions" rows={2} /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "maintenance-plan" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Maintenance Plan", "إنشاء خطة الصيانة")}</button>
      </form>}
    {uiEditor === "plan" && message && <p className="form-warning" role="status">{message}</p>}
  </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Equipment Document", "وثيقة المعدة")}</h2>
      <p className="muted">{tr("Record a controlled document or attachment reference. File-storage upload can use the storage-key field through the API when a storage provider is connected.", "سجل وثيقة مضبوطة أو مرجع مرفق. يمكن لرفع الملفات استخدام حقل storage-key عبر API عند ربط مزود تخزين.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={() => { setMessage(""); setUiEditor("document"); }}>
    {tr("Record Equipment Document", "إضافة وثيقة معدة")}
  </button>
  <CrudModal open={uiEditor === "document"} onClose={() => { if (!busy) setUiEditor(""); }}
    size="compact"
    title={tr("Record Equipment Document", "إضافة وثيقة معدة")}
    description={tr("Attach controlled equipment documentation without changing clinical history.", "أضف وثائق المعدة المضبوطة دون تغيير التاريخ السريري.")}>
    {uiEditor === "document" && <form className="catalog-form" onSubmit={equipmentDocument}>
        <label className="form-span">{tr("Equipment", "المعدة")}<select name="equipmentId" required defaultValue=""><option value="">{tr("Select equipment…", "اختر المعدة…")}</option>{equipmentOptions.map(item => <option key={item.id} value={item.id}>{item.assetId} — {item.name}</option>)}</select></label>
        <label>{tr("Document type", "نوع الوثيقة")}<input name="documentType" required placeholder="MANUAL / CERTIFICATE / SERVICE_REPORT" /></label>
        <label>{tr("Name", "الاسم")}<input name="name" required /></label>
        <label className="form-span">{tr("External URL", "رابط خارجي")}<input name="externalUrl" type="url" required placeholder="https://…" /></label>
        <label>{tr("Expiry", "الانتهاء")}<SystemDateField name="expiresAt" /></label>
        <label className="form-span">{tr("Notes", "ملاحظات")}<textarea name="notes" rows={2} /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "document" ? tr("Saving…", "جارٍ الحفظ…") : tr("Record Document", "تسجيل الوثيقة")}</button>
      </form>}
    {uiEditor === "document" && message && <p className="form-warning" role="status">{message}</p>}
  </CrudModal>
    </article>

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
