"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type BranchOption = { id: string; code: string; nameEn: string };

export function SpecimenActions({
  specimenId,
  barcode,
  status,
  specimenTypeConfigured,
  branches,
  activeBranchId,
  locale,
}: {
  specimenId: string;
  barcode: string;
  status: string;
  specimenTypeConfigured: boolean;
  branches: BranchOption[];
  activeBranchId: string | null;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [mode, setMode] = useState<"COLLECT" | "RECEIVE" | "REJECT" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

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
        ? `${tr("Rejected. Recollection barcode created", "تم رفض العينة. تم إنشاء باركود لإعادة السحب")}: ${body.replacementBarcode}`
        : `${barcode} ${tr("updated successfully.", "تم تحديثه بنجاح.")}`);
      setMode(null);
      router.refresh();
    } else {
      setMessage(body.error || tr("Specimen action failed.", "فشل إجراء العينة."));
    }
    setBusy(false);
  }

  return <div className="specimen-actions">
    <div className="specimen-action-buttons">
      {status === "PLANNED" && <button className="primary-button" disabled={!specimenTypeConfigured} onClick={() => setMode("COLLECT")}>{tr("Collect", "جمع")}</button>}
      {["COLLECTED","IN_TRANSIT"].includes(status) && <button className="primary-button" onClick={() => setMode("RECEIVE")}>{tr("Receive", "استلام")}</button>}
      {["COLLECTED","RECEIVED"].includes(status) && <button className="danger-button" onClick={() => setMode("REJECT")}>{tr("Reject", "رفض")}</button>}
    </div>

    {!specimenTypeConfigured && status === "PLANNED" && <p className="form-error">{tr("Collection blocked: specimen type is not configured for this test.", "تعذر جمع العينة لأن نوع العينة غير مهيأ لهذا الفحص.")}</p>}
    {message && <p className="form-success">{message}</p>}

    {mode && <form className="catalog-form specimen-action-form" onSubmit={submit}>
      <label className="form-span">{tr("Branch", "الفرع")}
        <select name="branchId" required defaultValue={activeBranchId || ""}>
          <option value="">{tr("Select branch…", "اختر الفرع…")}</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
        </select>
      </label>

      {mode === "COLLECT" && <>
        <label>{tr("Volume", "الحجم")}<input name="volume" type="number" min="0" step="0.001" /></label>
        <label>{tr("Volume", "الحجم")} unit<input name="volumeUnit" maxLength={30} placeholder="mL" /></label>
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
