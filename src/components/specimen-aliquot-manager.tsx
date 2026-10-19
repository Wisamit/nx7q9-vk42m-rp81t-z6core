"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemDateText } from "@/components/system-date-text";

type ContainerOption = { id: string; code: string; name: string };
type OrderItemOption = { id: string; code: string; name: string };
type ChildAliquot = {
  id: string;
  barcode: string;
  status: string;
  volume: string | null;
  remainingVolume: string | null;
  volumeUnit: string | null;
  storageLocation: string | null;
};
type UsageRow = {
  id: string;
  usageType: string;
  volumeUsed: string;
  volumeUnit: string;
  usedAt: string;
  branchTimeZone: string;
  notes: string | null;
  orderItemCode: string | null;
  childBarcode: string | null;
  usedByName: string;
  branchCode: string;
};

export function SpecimenAliquotManager({
  specimenId,
  currentBranchId,
  canManageStorageSettings,
  status,
  originalVolume,
  originalVolumeUnit,
  remainingVolume,
  remainingVolumeUnit,
  storageLocation,
  containers,
  orderItems,
  childAliquots,
  usageEvents,
  canManage,
  canPrintLabels,
  locale,
}: {
  specimenId: string;
  currentBranchId: string | null;
  canManageStorageSettings: boolean;
  status: string;
  originalVolume: string | null;
  originalVolumeUnit: string | null;
  remainingVolume: string | null;
  remainingVolumeUnit: string | null;
  storageLocation: string | null;
  containers: ContainerOption[];
  orderItems: OrderItemOption[];
  childAliquots: ChildAliquot[];
  usageEvents: UsageRow[];
  canManage: boolean;
  canPrintLabels: boolean;
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [locations, setLocations] = useState<Array<{ id: string; path: string; status: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsError, setMessageIsError] = useState(false);
  const [actionModal, setActionModal] = useState("");
  const usable = ["COLLECTED","RECEIVED","IN_PROCESS"].includes(status);
  useEffect(() => {
    if (!currentBranchId) return;
    fetch(`/api/settings/specimen-storage-locations?branchId=${encodeURIComponent(currentBranchId)}${canManageStorageSettings ? "&includeInactive=true" : ""}`)
      .then(response => response.ok ? response.json() : { locations: [] })
      .then(data => setLocations(Array.isArray(data.locations) ? data.locations : []))
      .catch(() => setLocations([]));
  }, [currentBranchId, canManageStorageSettings]);

  function errorMessage(code: unknown) {
    const key = typeof code === "string" ? code : "";
    const messages: Record<string, string> = {
      available_volume_reconciliation_required: tr("Available volume must be reconciled before aliquoting or recording usage.", "يجب تسوية الحجم المتاح قبل إنشاء جزء مشتق أو تسجيل استخدام."),
      specimen_status_not_usable: tr("This specimen status does not allow volume use.", "حالة هذه العينة لا تسمح باستخدام الحجم."),
      specimen_status_not_reconcilable: tr("This specimen status does not allow volume reconciliation.", "حالة هذه العينة لا تسمح بتسوية الحجم."),
      invalid_usage_volume: tr("Enter a valid positive volume.", "أدخل حجمًا موجبًا صالحًا."),
      invalid_available_volume: tr("Enter a valid available volume.", "أدخل حجمًا متاحًا صالحًا."),
      volume_unit_required: tr("Volume unit is required.", "وحدة الحجم مطلوبة."),
      volume_unit_mismatch: tr("Volume unit must match the tracked specimen unit.", "يجب أن تطابق وحدة الحجم وحدة العينة المتتبعة."),
      insufficient_available_volume: tr("Requested volume exceeds the available balance.", "الحجم المطلوب يتجاوز الرصيد المتاح."),
      available_volume_exceeds_original: tr("Available volume cannot exceed the original tracked volume.", "لا يمكن أن يتجاوز الحجم المتاح الحجم الأصلي المتتبع."),
      reconciliation_reason_required: tr("A reconciliation reason is required.", "سبب تسوية الحجم مطلوب."),
      aliquot_tests_required: tr("Testing and send-out aliquots require at least one linked test.", "الأجزاء المخصصة للفحص أو الإرسال الخارجي تتطلب فحصًا مرتبطًا واحدًا على الأقل."),
      aliquot_order_item_not_linked_to_parent: tr("A selected test is not linked to the parent specimen.", "أحد الفحوصات المحددة غير مرتبط بالعينة الأصلية."),
      usage_order_item_required: tr("Select the test that consumed this specimen volume.", "اختر الفحص الذي استهلك حجم العينة."),
      usage_order_item_not_linked: tr("The selected test is not linked to this specimen.", "الفحص المحدد غير مرتبط بهذه العينة."),
      specimen_volume_changed: tr("Available volume changed concurrently. Review the updated balance and try again.", "تغير الحجم المتاح بالتزامن. راجع الرصيد الجديد وحاول مجددًا."),
      specimen_order_not_active: tr("This order was cancelled or completed. The specimen volume was not changed.", "الطلب ملغى أو مكتمل. لم يتغير حجم العينة."),
      container_not_found: tr("Selected aliquot container is unavailable.", "حاوية الجزء المشتق المحددة غير متاحة."),
      storage_location_has_active_specimens: tr("Move all active specimens out of this position before deactivating it.", "انقل جميع العينات الفعالة من هذا الموقع قبل تعطيله."),
      invalid_storage_status_change: tr("Location, status and reason are required.", "الموقع والحالة والسبب مطلوبة."),
      storage_location_not_registered: tr("Choose a registered active storage position at this branch.", "اختر موقع تخزين معرّفًا وفعّالًا في هذا الفرع."),
      container_not_active: tr("The selected container was deactivated; choose another active container.", "تم تعطيل الحاوية المختارة؛ اختر حاوية فعّالة أخرى."),
      storage_location_exists: tr("This storage location is already registered.", "موقع التخزين معرّف مسبقًا."),
      storage_position_required: tr("Structured storage position is required.", "موقع التخزين المنظّم مطلوب."),
      storage_position_incomplete: tr("Enter zone, storage unit, rack and slot.", "أدخل المنطقة ووحدة التخزين والرف والموضع."),
      storage_position_invalid: tr("Storage position contains invalid characters or is too long.", "موقع التخزين يحتوي أحرفًا غير مسموحة أو يتجاوز الطول المسموح."),
      storage_location_required: tr("Storage location is required.", "موقع التخزين مطلوب."),
      storage_relocation_reason_required: tr("A storage relocation reason is required.", "سبب تغيير موقع التخزين مطلوب."),
      specimen_status_not_relocatable: tr("This specimen status does not allow storage relocation.", "حالة هذه العينة لا تسمح بتغيير موقع التخزين."),
      specimen_state_changed: tr("Specimen state changed concurrently. Refresh and try again.", "تغيرت حالة العينة بالتزامن. حدّث الصفحة وحاول مجددًا."),
    };
    return messages[key] || key || tr("Specimen volume action failed.", "فشلت عملية حجم العينة.");
  }

  async function post(path: string, payload: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessageIsError(true);
        setMessage(errorMessage(body.error));
        if (response.status === 409) router.refresh();
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setMessageIsError(true);
      setMessage(tr("Connection failed during specimen operation.", "فشل الاتصال أثناء عملية العينة."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reconcile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await post(`/api/specimens/${specimenId}/volume-reconcile`, {
      availableVolume: form.get("availableVolume"),
      availableVolumeUnit: form.get("availableVolumeUnit"),
      reason: form.get("reason"),
    });
    if (ok) { setActionModal(""); setMessage(tr("Available volume reconciled and audited.", "تمت تسوية الحجم المتاح وتسجيلها.")); }
  }

  async function createAliquot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await post(`/api/specimens/${specimenId}/aliquots`, {
      volume: form.get("volume"),
      volumeUnit: form.get("volumeUnit"),
      purpose: form.get("purpose"),
      containerId: form.get("containerId"),
      storageLocation: form.get("storageLocation"),
      notes: form.get("notes"),
      orderItemIds: form.getAll("orderItemIds"),
    });
    if (ok) {
      setActionModal("");
      setMessage(tr("Aliquot created with an independent barcode and lineage record.", "تم إنشاء الجزء المشتق بباركود مستقل وسجل تتبع للأصل."));
    }
  }

  async function refreshLocations(includeInactive = canManageStorageSettings) {
    if (!currentBranchId) return false;
    try {
      const params = new URLSearchParams({ branchId: currentBranchId });
      if (includeInactive) params.set("includeInactive", "true");
      const response = await fetch("/api/settings/specimen-storage-locations?" + params.toString());
      if (!response.ok) return false;
      const data = await response.json();
      if (!Array.isArray(data.locations)) return false;
      setLocations(data.locations);
      return true;
    } catch {
      return false;
    }
  }

  async function registerStorage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || storageBusy) return;
    const form = new FormData(event.currentTarget);
    const ok = await post("/api/settings/specimen-storage-locations", {
      branchId: currentBranchId,
      storagePosition: {
        zone: form.get("zone"), unit: form.get("unit"),
        rack: form.get("rack"), slot: form.get("slot"),
      },
    });
    if (!ok) return;
    setActionModal("");
    const refreshed = await refreshLocations();
    setMessage(refreshed
      ? tr("Storage location registered for this branch.", "تم تعريف موقع التخزين لهذا الفرع.")
      : tr("Storage location registered; location list could not refresh.", "تم تعريف موقع التخزين؛ تعذر تحديث قائمة المواقع."));
  }

  async function changeStorageStatus(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (storageBusy || busy) return;
    const form = new FormData(event.currentTarget);
    setStorageBusy(true);
    setMessage("");
    setMessageIsError(false);
    try {
      const response = await fetch("/api/settings/specimen-storage-locations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: form.get("locationId"),
          status: form.get("status"),
          reason: form.get("reason"),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessageIsError(true);
        setMessage(errorMessage(body.error));
        return;
      }
      // A successful audited PATCH is not undone by a separate list-refresh failure.
      setActionModal("");
      const refreshed = await refreshLocations(true);
      setMessage(refreshed
        ? tr("Storage location status updated and audited.", "تم تحديث حالة موقع التخزين وتسجيل العملية.")
        : tr("Status saved, but location list could not refresh.", "تم حفظ الحالة ولكن تعذر تحديث قائمة مواقع التخزين."));
    } catch {
      setMessageIsError(true);
      setMessage(tr(
        "Connection interrupted; check the storage status before retrying.",
        "انقطع الاتصال؛ راجع حالة موقع التخزين قبل إعادة المحاولة.",
      ));
    } finally {
      setStorageBusy(false);
    }
  }

  async function relocateStorage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await post(`/api/specimens/${specimenId}/storage-location`, {
      storagePosition: (() => {
        const path = String(form.get("selectedLocation") || "");
        const parts = path.split(" / ");
        return { zone: parts[0], unit: parts[1], rack: parts[2], slot: parts[3] };
      })(),
      reason: form.get("reason"),
    });
    if (ok) { setActionModal(""); setMessage(tr("Physical storage location updated and audited.", "تم تحديث موقع التخزين الفعلي وتسجيله.")); }
  }

  async function recordUsage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ok = await post(`/api/specimens/${specimenId}/usage`, {
      usageType: form.get("usageType"),
      volumeUsed: form.get("volumeUsed"),
      volumeUnit: form.get("volumeUnit"),
      orderItemId: form.get("orderItemId"),
      notes: form.get("notes"),
    });
    if (ok) {
      setActionModal("");
      setMessage(tr("Specimen usage recorded and available volume updated.", "تم تسجيل استخدام العينة وتحديث الحجم المتاح."));
    }
  }

  const usageLabel = (value: string) => ({
    ALIQUOT: tr("Aliquot", "جزء مشتق"),
    TESTING: tr("Testing", "فحص"),
    REPEAT_TESTING: tr("Repeat testing", "إعادة فحص"),
    SEND_OUT: tr("Send-out", "إرسال خارجي"),
    OTHER: tr("Other", "أخرى"),
  }[value] || value);

  return <section className="specimen-aliquot-panel">
    <div className="table-toolbar">
      <div>
        <h3>{tr("Aliquots & Volume Traceability", "الأجزاء المشتقة وتتبع الحجم")}</h3>
        <span>{tr("Original volume is preserved; only the available balance is consumed.", "يُحفظ الحجم الأصلي دون تعديل، ويُنقص فقط الرصيد المتاح.")}</span>
      </div>
    </div>

    <div className="specimen-metadata">
      <div><span>{tr("Original volume", "الحجم الأصلي")}</span><strong>{originalVolume ? `${originalVolume} ${originalVolumeUnit || ""}` : "—"}</strong></div>
      <div><span>{tr("Available volume", "الحجم المتاح")}</span><strong>{remainingVolume ? `${remainingVolume} ${remainingVolumeUnit || ""}` : tr("Unknown / reconciliation required", "غير معروف / يحتاج تسوية")}</strong></div>
      <div><span>{tr("Storage location", "موقع التخزين")}</span><strong>{storageLocation || "—"}</strong></div>
      <div><span>{tr("Child aliquots", "الأجزاء المشتقة")}</span><strong>{childAliquots.length}</strong></div>
    </div>

    {canManage && usable && remainingVolume === null && <details className="specimen-history" open>
      <summary>{tr("Reconcile Available Volume", "تسوية الحجم المتاح")}</summary>
      <button type="button" className="secondary-button"
    disabled={busy || storageBusy} onClick={() => { setMessage(""); setActionModal("reconcile"); }}>
    {tr("Reconcile Available Volume", "تسوية الحجم المتاح")}
  </button>
  <CrudModal open={actionModal === "reconcile"}
    onClose={() => { if (!busy && !storageBusy) setActionModal(""); }}
    size="compact" title={tr("Reconcile Available Volume", "تسوية الحجم المتاح")}
    description={tr("Record physically measured volume with an audit reason. No volume may exceed the original tracked specimen.", "سجّل الحجم المقاس فعلياً مع سبب مدقق؛ لا يجوز تجاوز الحجم الأصلي المسجّل للعينة.")}>
    {actionModal === "reconcile" && <form className="catalog-form specimen-action-form" onSubmit={reconcile}>
        <label>{tr("Measured available volume", "الحجم المتاح المقاس")}<input name="availableVolume" type="number" min="0" step="0.001" max={originalVolume || undefined} required /></label>
        <label>{tr("Volume unit", "وحدة الحجم")}<input name="availableVolumeUnit" maxLength={30} defaultValue={originalVolumeUnit || ""} required /></label>
        <label className="form-span">{tr("Reconciliation reason", "سبب التسوية")}<textarea name="reason" rows={2} maxLength={1000} required /></label>
        <button className="primary-button form-span" disabled={busy}>{tr("Save Reconciled Volume", "حفظ الحجم بعد التسوية")}</button>
      </form>}
    {actionModal === "reconcile" && message && <p className="form-error" role="alert">{message}</p>}
  </CrudModal>
    </details>}

    {canManage && usable && <details className="specimen-history">
      <summary>{tr("Update Physical Storage", "تحديث موقع التخزين الفعلي")}</summary>
      {canManageStorageSettings && <><button type="button" className="secondary-button"
    disabled={busy || storageBusy} onClick={() => { setMessage(""); setActionModal("status"); }}>
    {tr("Change Storage Position Status", "تعديل حالة موقع التخزين")}
  </button>
  <CrudModal open={actionModal === "status"}
    onClose={() => { if (!busy && !storageBusy) setActionModal(""); }}
    size="compact" title={tr("Change Storage Position Status", "تعديل حالة موقع التخزين")}
    description={tr("Only authorized users may activate or deactivate branch storage positions. Active specimens block unsafe deactivation.", "يحق للمستخدمين المخوّلين تفعيل أو تعطيل مواقع تخزين الفرع؛ تمنع العينات الفعالة التعطيل غير الآمن.")}>
    {actionModal === "status" && <form className="catalog-form specimen-action-form" onSubmit={changeStorageStatus}>
        <strong className="form-span">{tr("Activate / deactivate storage location", "تفعيل / تعطيل موقع التخزين")}</strong>
        <label className="form-span">{tr("Registered position", "الموقع المعرّف")}
          <select name="locationId" defaultValue="" required>
            <option value="">{tr("Select position", "اختر الموقع")}</option>
            {locations.map(location => <option key={location.id} value={location.id}>{location.path} ({location.status})</option>)}
          </select>
        </label>
        <label>{tr("New status", "الحالة الجديدة")}
          <select name="status" defaultValue="INACTIVE"><option value="INACTIVE">{tr("Inactive", "غير فعّال")}</option><option value="ACTIVE">{tr("Active", "فعّال")}</option></select>
        </label>
        <label className="form-span">{tr("Reason", "السبب")}<textarea name="reason" maxLength={1000} required /></label>
        <button className="secondary-button form-span" disabled={storageBusy || busy}>{tr("Save status", "حفظ الحالة")}</button>
      </form>}
    {actionModal === "status" && message && <p className="form-error" role="alert">{message}</p>}
  </CrudModal></>}
      {canManageStorageSettings && <><button type="button" className="secondary-button"
    disabled={busy || storageBusy} onClick={() => { setMessage(""); setActionModal("register"); }}>
    {tr("Register Physical Storage Position", "تعريف موقع تخزين فعلي")}
  </button>
  <CrudModal open={actionModal === "register"}
    onClose={() => { if (!busy && !storageBusy) setActionModal(""); }}
    size="compact" title={tr("Register Physical Storage Position", "تعريف موقع تخزين فعلي")}
    description={tr("Register a structured zone, unit, rack and slot for the current branch.", "عرّف منطقة ووحدة ورفاً وموضعاً منظّماً للفرع الحالي.")}>
    {actionModal === "register" && <form className="catalog-form specimen-action-form" onSubmit={registerStorage}>
        <strong className="form-span">{tr("Register branch storage position", "تعريف موقع تخزين في الفرع")}</strong>
        <label>{tr("Zone / area", "المنطقة")}<input name="zone" maxLength={40} required /></label>
        <label>{tr("Fridge / freezer", "الثلاجة / المجمّد")}<input name="unit" maxLength={40} required /></label>
        <label>{tr("Rack / shelf", "الرف")}<input name="rack" maxLength={40} required /></label>
        <label>{tr("Position / slot", "الموضع")}<input name="slot" maxLength={40} required /></label>
        <button className="secondary-button form-span" disabled={busy}>{tr("Register position", "تعريف الموقع")}</button>
      </form>}
    {actionModal === "register" && message && <p className="form-error" role="alert">{message}</p>}
  </CrudModal></>}
      <button type="button" className="secondary-button"
    disabled={busy || storageBusy} onClick={() => { setMessage(""); setActionModal("relocate"); }}>
    {tr("Relocate Stored Specimen", "نقل موقع تخزين العينة")}
  </button>
  <CrudModal open={actionModal === "relocate"}
    onClose={() => { if (!busy && !storageBusy) setActionModal(""); }}
    size="compact" title={tr("Relocate Stored Specimen", "نقل موقع تخزين العينة")}
    description={tr("Select a registered position and reason. This updates the specimen location with an auditable movement.", "اختر موقعاً مسجلاً وسبب النقل. سيغيّر ذلك موقع العينة بحركة قابلة للتدقيق.")}>
    {actionModal === "relocate" && <form className="catalog-form specimen-action-form" onSubmit={relocateStorage}>
        <label className="form-span">{tr("Registered physical position", "موقع التخزين المعرّف")}
          <select name="selectedLocation" required defaultValue="">
            <option value="">{tr("Select a storage position", "اختر موقع التخزين")}</option>
            {locations.filter(location => location.status === "ACTIVE").map(location => <option key={location.id} value={location.path}>{location.path}</option>)}
          </select>
        </label>
        <label className="form-span">{tr("Relocation reason", "سبب تغيير الموقع")}<textarea name="reason" rows={2} maxLength={1000} required /></label>
        <button className="secondary-button form-span" disabled={busy}>{tr("Update Storage Location", "تحديث موقع التخزين")}</button>
      </form>}
    {actionModal === "relocate" && message && <p className="form-error" role="alert">{message}</p>}
  </CrudModal>
    </details>}

    {canManage && usable && remainingVolume !== null && Number(remainingVolume) > 0 && <div className="admin-grid">
      <details className="specimen-history">
        <summary>{tr("Create Aliquot", "إنشاء جزء مشتق")}</summary>
        <button type="button" className="secondary-button"
    disabled={busy || storageBusy} onClick={() => { setMessage(""); setActionModal("aliquot"); }}>
    {tr("Create Traceable Aliquot", "إنشاء جزء مشتق قابل للتتبع")}
  </button>
  <CrudModal open={actionModal === "aliquot"}
    onClose={() => { if (!busy && !storageBusy) setActionModal(""); }}
    size="compact" title={tr("Create Traceable Aliquot", "إنشاء جزء مشتق قابل للتتبع")}
    description={tr("A new barcode and parent-child lineage are created. Confirm the specimen, volume, unit, container and linked tests.", "سيُنشأ باركود جديد وسجل تتبع للأصل. راجع العينة والحجم والوحدة والحاوية والفحوص المرتبطة.")}>
    {actionModal === "aliquot" && <form className="catalog-form specimen-action-form" onSubmit={createAliquot}>
          <label>{tr("Purpose", "الغرض")}<select name="purpose" defaultValue="TESTING">
            <option value="TESTING">{tr("Testing", "فحص")}</option>
            <option value="STORAGE">{tr("Storage", "تخزين")}</option>
            <option value="SEND_OUT">{tr("Send-out", "إرسال خارجي")}</option>
            <option value="OTHER">{tr("Other", "أخرى")}</option>
          </select></label>
          <label>{tr("Aliquot volume", "حجم الجزء")}<input name="volume" type="number" min="0.001" max={remainingVolume} step="0.001" required /></label>
          <label>{tr("Volume unit", "وحدة الحجم")}<input name="volumeUnit" value={remainingVolumeUnit || ""} readOnly required /></label>
          <label>{tr("Aliquot container", "حاوية الجزء")}<select name="containerId" defaultValue="">
            <option value="">{tr("Inherit parent container", "استخدام حاوية العينة الأصلية")}</option>
            {containers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
          </select></label>
          <label className="form-span">{tr("Storage / physical location", "التخزين / الموقع الفعلي")}<select name="storageLocation" defaultValue=""><option value="">{tr("Not assigned", "غير محدد")}</option>{locations.filter(item => item.status === "ACTIVE").map(item => <option key={item.id} value={item.path}>{item.path}</option>)}</select></label>
          <fieldset className="form-span">
            <legend>{tr("Linked tests for this aliquot", "الفحوصات المرتبطة بهذا الجزء")}</legend>
            <div className="permission-grid">
              {orderItems.map(item => <label key={item.id} className="checkbox-row">
                <input type="checkbox" name="orderItemIds" value={item.id} />
                <span><strong>{item.code}</strong> — {item.name}</span>
              </label>)}
            </div>
          </fieldset>
          <label className="form-span">{tr("Notes", "ملاحظات")}<textarea name="notes" rows={2} maxLength={1000} /></label>
          <button className="primary-button form-span" disabled={busy}>{tr("Create Traceable Aliquot", "إنشاء جزء مشتق قابل للتتبع")}</button>
        </form>}
    {actionModal === "aliquot" && message && <p className="form-error" role="alert">{message}</p>}
  </CrudModal>
      </details>

      <details className="specimen-history">
        <summary>{tr("Record Specimen Usage", "تسجيل استخدام العينة")}</summary>
        <button type="button" className="secondary-button"
    disabled={busy || storageBusy} onClick={() => { setMessage(""); setActionModal("usage"); }}>
    {tr("Record Specimen Volume Consumption", "تسجيل استهلاك حجم العينة")}
  </button>
  <CrudModal open={actionModal === "usage"}
    onClose={() => { if (!busy && !storageBusy) setActionModal(""); }}
    size="compact" title={tr("Record Specimen Volume Consumption", "تسجيل استهلاك حجم العينة")}
    description={tr("This permanently records consumption against available specimen volume; the server rechecks the measured balance and branch.", "يسجّل الاستهلاك بشكل دائم مقابل الحجم المتاح؛ يعيد السيرفر التحقق من الرصيد والفرع.")}>
    {actionModal === "usage" && <form className="catalog-form specimen-action-form" onSubmit={recordUsage}>
          <label>{tr("Usage", "الاستخدام")}<select name="usageType" defaultValue="TESTING">
            <option value="TESTING">{tr("Testing", "فحص")}</option>
            <option value="REPEAT_TESTING">{tr("Repeat testing", "إعادة فحص")}</option>
            <option value="SEND_OUT">{tr("Send-out", "إرسال خارجي")}</option>
            <option value="OTHER">{tr("Other", "أخرى")}</option>
          </select></label>
          <label>{tr("Volume used", "الحجم المستخدم")}<input name="volumeUsed" type="number" min="0.001" max={remainingVolume} step="0.001" required /></label>
          <label>{tr("Volume unit", "وحدة الحجم")}<input name="volumeUnit" value={remainingVolumeUnit || ""} readOnly required /></label>
          <label>{tr("Related test", "الفحص المرتبط")}<select name="orderItemId" defaultValue="">
            <option value="">{tr("Select when applicable…", "اختر عند الانطباق…")}</option>
            {orderItems.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
          </select></label>
          <label className="form-span">{tr("Usage notes", "ملاحظات الاستخدام")}<textarea name="notes" rows={2} maxLength={1000} /></label>
          <button className="primary-button form-span" disabled={busy}>{tr("Record Usage", "تسجيل الاستخدام")}</button>
        </form>}
    {actionModal === "usage" && message && <p className="form-error" role="alert">{message}</p>}
  </CrudModal>
      </details>
    </div>}

    {message && <p className={messageIsError ? "form-error" : "form-success"} role={messageIsError ? "alert" : "status"}>{message}</p>}

    {childAliquots.length > 0 && <div className="table-wrap">
      <table>
        <thead><tr>
          <th>{tr("Aliquot barcode", "باركود الجزء")}</th>
          <th>{tr("Status", "الحالة")}</th>
          <th>{tr("Initial volume", "الحجم الابتدائي")}</th>
          <th>{tr("Available", "المتاح")}</th>
          <th>{tr("Storage", "التخزين")}</th>
          <th>{tr("Actions", "الإجراءات")}</th>
        </tr></thead>
        <tbody>{childAliquots.map(child => <tr key={child.id}>
          <td><strong>{child.barcode}</strong></td><td>{child.status}</td>
          <td>{child.volume ? `${child.volume} ${child.volumeUnit || ""}` : "—"}</td>
          <td>{child.remainingVolume ? `${child.remainingVolume} ${child.volumeUnit || ""}` : "—"}</td>
          <td>{child.storageLocation || "—"}</td>
          <td><div className="header-actions">
            <Link className="secondary-link" href={"/specimens?q=" + encodeURIComponent(child.barcode)}>{tr("Open", "فتح")}</Link>
            {canPrintLabels && <Link className="secondary-link" href={`/specimens/${child.id}/label`}>{tr("Label", "الملصق")}</Link>}
          </div></td>
        </tr>)}</tbody>
      </table>
    </div>}

    {usageEvents.length > 0 && <details className="specimen-history">
      <summary>{tr("Volume Usage History", "سجل استخدام الحجم")} ({usageEvents.length})</summary>
      <div className="summary-list">
        {usageEvents.map(item => <div key={item.id}>
          <span><SystemDateText value={item.usedAt} timeZone={item.branchTimeZone} /> · {item.branchCode} · {item.usedByName} · {item.volumeUsed} {item.volumeUnit}</span>
          <strong>{usageLabel(item.usageType)}{item.orderItemCode ? ` · ${item.orderItemCode}` : ""}{item.childBarcode ? ` · → ${item.childBarcode}` : ""}</strong>
          {item.notes && <small>{item.notes}</small>}
        </div>)}
      </div>
    </details>}
  </section>;
}
