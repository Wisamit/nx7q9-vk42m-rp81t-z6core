"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type BranchOption = { id: string; code: string; nameEn: string };

export function SpecimenActions({
  specimenId,
  orderId,
  barcode,
  status,
  specimenTypeConfigured,
  requirementsFinalized,
  requiredVolume,
  requiredVolumeUnit,
  collectionInstructions,
  branches,
  activeBranchId,
  locale,
  canCollect,
  canReceive,
  canReject,
}: {
  specimenId: string;
  orderId: string;
  barcode: string;
  status: string;
  specimenTypeConfigured: boolean;
  requirementsFinalized: boolean;
  requiredVolume: string | null;
  requiredVolumeUnit: string | null;
  collectionInstructions: string[];
  branches: BranchOption[];
  activeBranchId: string | null;
  locale: "ar" | "en";
  canCollect: boolean;
  canReceive: boolean;
  canReject: boolean;
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [mode, setMode] = useState<"COLLECT" | "RECEIVE" | "REJECT" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function actionError(body: Record<string, unknown>) {
    const code = typeof body.error === "string" ? body.error : "";
    const errors: Record<string, string> = {
      specimen_requirements_not_finalized: tr("Collection requirements must be finalized first.", "يجب تثبيت متطلبات العينة قبل الجمع."),
      specimen_requirement_configuration_incomplete: tr("Collection is blocked because the specimen requirement configuration is incomplete.", "تم منع الجمع لأن إعداد متطلبات العينة غير مكتمل."),
      specimen_volume_required: tr("Collected volume is required for this specimen.", "حجم العينة المجموعة مطلوب لهذه العينة."),
      specimen_volume_unit_mismatch: tr("Collected volume unit must match the planned requirement.", "يجب أن تطابق وحدة الحجم المجموعة وحدة المتطلب المخطط."),
      insufficient_specimen_volume: tr("Collected volume is below the required minimum.", "الحجم المجموعة أقل من الحد الأدنى المطلوب."),
      incompatible_specimen_requirements: tr("Linked tests have incompatible specimen requirements. Review the test catalog before collection.", "الفحوصات المرتبطة لها متطلبات عينات غير متوافقة. راجع دليل الفحوصات قبل الجمع."),
      specimen_plan_catalog_mismatch: tr("The planned specimen no longer matches its catalog configuration.", "العينة المخططة لم تعد مطابقة لإعداد دليل الفحوصات."),
      non_planned_specimen_without_requirement_snapshot: tr("This historical specimen cannot be finalized after its lifecycle has started.", "لا يمكن تثبيت متطلبات هذه العينة التاريخية بعد بدء دورة حياتها."),
      active_child_aliquots_require_resolution: tr("Reject or dispose active child aliquots before rejecting their primary specimen.", "يجب رفض أو التخلص من الأجزاء المشتقة الفعالة قبل رفض العينة الأصلية."),
    };
    return errors[code] || code || tr("Specimen action failed.", "فشل إجراء العينة.");
  }

  async function finalizeRequirements() {
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/orders/${orderId}/specimen-requirements/finalize`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("Specimen requirements finalized. Collection controls are now active.", "تم تثبيت متطلبات العينات وأصبحت ضوابط الجمع فعالة."));
      router.refresh();
    } else {
      setMessage(actionError(body));
    }
    setBusy(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const response = await fetch(`/api/specimens/${specimenId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: mode,
        branchId: form.get("branchId"),
        volume: form.get("volume"),
        volumeUnit: form.get("volumeUnit"),
        notes: form.get("notes"),
        rejectionReasonCode: form.get("rejectionReasonCode"),
        rejectionReasonText: form.get("rejectionReasonText"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(mode === "REJECT"
        ? body.replacementType === "ALIQUOT"
          ? `${tr("Aliquot rejected. Derive any replacement from parent", "تم رفض الجزء المشتق. أنشئ أي بديل من العينة الأصلية")}: ${body.parentBarcode || "—"}`
          : `${tr("Rejected. Recollection barcode created", "تم رفض العينة. تم إنشاء باركود لإعادة السحب")}: ${body.replacementBarcode}`
        : `${barcode} ${tr("updated successfully.", "تم تحديثه بنجاح.")}`);
      setMode(null);
      router.refresh();
    } else {
      setMessage(actionError(body));
    }
    setBusy(false);
  }

  return <div className="specimen-actions">
    <div className="specimen-action-buttons">
      {canCollect && status === "PLANNED" && !requirementsFinalized && <button type="button" className="secondary-button" disabled={busy} onClick={finalizeRequirements}>{tr("Finalize Requirements", "تثبيت المتطلبات")}</button>}
      {canCollect && status === "PLANNED" && requirementsFinalized && <button type="button" className="primary-button" disabled={!specimenTypeConfigured} onClick={() => setMode("COLLECT")}>{tr("Collect", "جمع")}</button>}
      {canReceive && ["COLLECTED","IN_TRANSIT"].includes(status) && <button type="button" className="primary-button" onClick={() => setMode("RECEIVE")}>{tr("Receive", "استلام")}</button>}
      {canReject && ["COLLECTED","RECEIVED"].includes(status) && <button type="button" className="danger-button" onClick={() => setMode("REJECT")}>{tr("Reject", "رفض")}</button>}
    </div>

    {canCollect && status === "PLANNED" && !requirementsFinalized && <p className="form-warning">{tr("Collection is locked until the order's specimen requirements are finalized.", "الجمع مقفل حتى يتم تثبيت متطلبات عينات الطلب.")}</p>}
    {canCollect && !specimenTypeConfigured && status === "PLANNED" && <p className="form-error">{tr("Collection blocked: specimen type is not configured for this test.", "تعذر جمع العينة لأن نوع العينة غير مهيأ لهذا الفحص.")}</p>}
    {requirementsFinalized && requiredVolume && status === "PLANNED" && <p className="muted"><strong>{tr("Minimum required volume", "الحد الأدنى المطلوب")}: {requiredVolume} {requiredVolumeUnit || ""}</strong></p>}
    {requirementsFinalized && collectionInstructions.length > 0 && status === "PLANNED" && <div className="muted"><strong>{tr("Collection instructions", "تعليمات الجمع")}:</strong> {collectionInstructions.join(" · ")}</div>}
    {message && <p className="form-success">{message}</p>}

    {mode && <form className="catalog-form specimen-action-form" onSubmit={submit}>
      <label className="form-span">{tr("Branch", "الفرع")}
        <select name="branchId" required defaultValue={activeBranchId || ""}>
          <option value="">{tr("Select branch…", "اختر الفرع…")}</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
        </select>
      </label>

      {mode === "COLLECT" && <>
        <label>{tr("Volume", "الحجم")}<input name="volume" type="number" step="0.001" required={Boolean(requiredVolume)} min={requiredVolume || "0"} /></label>
        <label>{tr("Volume unit", "وحدة الحجم")}<input name="volumeUnit" maxLength={30} placeholder="mL" required={Boolean(requiredVolumeUnit)} defaultValue={requiredVolumeUnit || ""} readOnly={Boolean(requiredVolumeUnit)} /></label>
        <label className="form-span">{tr("Collection notes", "ملاحظات الجمع")}<textarea name="notes" rows={2} /></label>
      </>}

      {mode === "REJECT" && <>
        <label>{tr("Reason code", "رمز سبب الرفض")}<select name="rejectionReasonCode" required defaultValue="">
          <option value="">{tr("Select reason…", "اختر السبب…")}</option>
          <option value="HEMOLYZED">{tr("Hemolyzed", "انحلال دم")}</option>
          <option value="CLOTTED">{tr("Clotted", "متخثرة")}</option>
          <option value="INSUFFICIENT_VOLUME">{tr("Insufficient volume", "حجم غير كافٍ")}</option>
          <option value="WRONG_CONTAINER">{tr("Wrong container", "حاوية غير صحيحة")}</option>
          <option value="LEAKING">{tr("Leaking", "تسرب")}</option>
          <option value="MISLABELED">{tr("Mislabeled", "ملصق خاطئ")}</option>
          <option value="DELAYED_TRANSPORT">{tr("Delayed transport", "تأخر النقل")}</option>
          <option value="OTHER">{tr("Other", "أخرى")}</option>
        </select></label>
        <label className="form-span">{tr("Reason details", "تفاصيل سبب الرفض")}<textarea name="rejectionReasonText" rows={2} required /></label>
      </>}

      <div className="form-span specimen-form-actions">
        <button className="secondary-button" type="button" onClick={() => setMode(null)}>{tr("Cancel", "إلغاء")}</button>
        <button className={mode === "REJECT" ? "danger-button" : "primary-button"} disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr(mode, mode === "COLLECT" ? "جمع" : mode === "RECEIVE" ? "استلام" : "رفض")}</button>
      </div>
    </form>}
  </div>;
}
