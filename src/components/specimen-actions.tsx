"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type BranchOption = { id: string; code: string; nameEn: string };
type OrderItemOption = { id: string; code: string; name: string };
type RejectionReasonOption = { id: string; code: string; name: string };

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
  expectedContainerCode,
  orderItems,
  rejectionReasons,
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
  expectedContainerCode: string | null;
  orderItems: OrderItemOption[];
  rejectionReasons: RejectionReasonOption[];
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
  const [rejectionScope, setRejectionScope] = useState<"WHOLE_SPECIMEN" | "SELECTED_TESTS">("WHOLE_SPECIMEN");
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
      invalid_label_assessment: tr("Select the specimen label assessment.", "اختر تقييم ملصق العينة."),
      invalid_specimen_condition: tr("Select the observed specimen condition.", "اختر حالة العينة عند الاستلام."),
      invalid_temperature_c: tr("Temperature must be a valid Celsius value.", "يجب أن تكون درجة الحرارة قيمة مئوية صالحة."),
      reception_discrepancy_details_required: tr("Describe the reception discrepancy when label, condition or container does not match.", "اشرح التباين عند اختلاف الملصق أو حالة العينة أو الحاوية."),
      rejection_reason_scope_required: tr("Rejection reason, scope and details are required.", "سبب الرفض ونطاقه والتفاصيل مطلوبة."),
      rejection_reason_not_active: tr("This rejection reason is no longer active.", "سبب الرفض هذا لم يعد فعالًا."),
      invalid_rejection_test_selection: tr("Select one or more active tests affected by this rejection.", "اختر فحصًا فعالًا واحدًا أو أكثر متأثرًا بالرفض."),
      use_whole_specimen_scope_for_all_tests: tr("All tests are selected. Use whole-specimen rejection instead.", "تم تحديد جميع الفحوصات. استخدم رفض العينة كاملة بدلًا من ذلك."),
      affected_tests_already_have_results: tr("One or more affected tests already have results. Use the controlled result/amendment workflow instead.", "يوجد نتائج لفحص أو أكثر من الفحوصات المتأثرة. استخدم مسار النتائج/التعديل المنضبط بدلًا من ذلك."),
      active_child_aliquots_require_resolution: tr("Resolve active child aliquots before rejecting the whole source specimen.", "عالج الأجزاء المشتقة الفعالة قبل رفض العينة الأصلية كاملة."),
      affected_tests_have_active_child_aliquots: tr("An active child aliquot already carries one of the selected tests.", "يوجد جزء مشتق فعال يحمل أحد الفحوصات المحددة."),
      affected_tests_analytical_work_started: tr("Analytical work already started for an affected test.", "بدأ العمل التحليلي بالفعل لأحد الفحوصات المتأثرة."),
      affected_tests_microbiology_work_started: tr("A microbiology case already exists for an affected test.", "توجد حالة أحياء دقيقة بالفعل لأحد الفحوصات المتأثرة."),
      affected_tests_sendout_active: tr("An active external-laboratory referral exists for an affected test.", "توجد إحالة فعالة لمختبر خارجي لأحد الفحوصات المتأثرة."),
      affected_tests_analyzer_work_started: tr("Analyzer observations are already staged or imported for an affected test.", "تم تجهيز أو استيراد قراءات جهاز بالفعل لأحد الفحوصات المتأثرة."),
      specimen_preanalytical_state_changed: tr("Specimen state changed concurrently. Refresh and review before retrying.", "تغيرت حالة العينة بالتزامن. حدّث الصفحة وراجعها قبل إعادة المحاولة."),
      completed_order_requires_result_amendment_workflow: tr("The order is already completed. Use the controlled result/amendment workflow.", "الطلب مكتمل بالفعل. استخدم مسار النتائج/التعديل المنضبط."),
      order_cancelled: tr("The order is cancelled.", "الطلب ملغى."),
      rejection_branch_must_match_specimen_location: tr("Rejection must be recorded at the specimen's current custody branch.", "يجب تسجيل الرفض في فرع الحيازة الحالي للعينة."),
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

    const isReject = mode === "REJECT";
    const endpoint = isReject
      ? `/api/specimens/${specimenId}/rejections`
      : `/api/specimens/${specimenId}/actions`;

    const payload = isReject ? {
      branchId: form.get("branchId"),
      rejectionReasonId: form.get("rejectionReasonId"),
      reasonDetails: form.get("reasonDetails"),
      scope: rejectionScope,
      orderItemIds: form.getAll("orderItemIds"),
    } : {
      action: mode,
      branchId: form.get("branchId"),
      volume: form.get("volume"),
      volumeUnit: form.get("volumeUnit"),
      notes: form.get("notes"),
      labelAssessment: form.get("labelAssessment"),
      conditionCode: form.get("conditionCode"),
      temperatureC: form.get("temperatureC"),
      observedContainerCode: form.get("observedContainerCode"),
      discrepancyText: form.get("discrepancyText"),
      receptionNotes: form.get("receptionNotes"),
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      if (isReject) {
        if (body.replacementType === "PATIENT_RECOLLECTION") {
          setMessage(`${tr(
            rejectionScope === "WHOLE_SPECIMEN" ? "Specimen rejected. Recollection barcode created" : "Selected tests rejected. Targeted recollection barcode created",
            rejectionScope === "WHOLE_SPECIMEN" ? "تم رفض العينة. تم إنشاء باركود لإعادة السحب" : "تم رفض الفحوصات المحددة. تم إنشاء باركود لإعادة السحب المستهدف",
          )}: ${body.replacementBarcode || "—"}`);
        } else {
          setMessage(tr(
            "Aliquot rejection recorded. Derive any required replacement from its parent specimen.",
            "تم تسجيل رفض الجزء المشتق. أنشئ أي بديل مطلوب من العينة الأصلية.",
          ));
        }
      } else {
        setMessage(`${barcode} ${tr("updated successfully.", "تم تحديثه بنجاح.")}`);
      }
      setMode(null);
      setRejectionScope("WHOLE_SPECIMEN");
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

      {mode === "RECEIVE" && <>
        <label>{tr("Label assessment", "تقييم الملصق")}<select name="labelAssessment" defaultValue="MATCHED" required>
          <option value="MATCHED">{tr("Matched", "مطابق")}</option>
          <option value="UNLABELED">{tr("Unlabeled", "بدون ملصق")}</option>
          <option value="MISMATCHED">{tr("Mismatched", "غير مطابق")}</option>
        </select></label>
        <label>{tr("Specimen condition", "حالة العينة")}<select name="conditionCode" defaultValue="GOOD" required>
          <option value="GOOD">{tr("Acceptable / good", "مقبولة / جيدة")}</option>
          <option value="HEMOLYZED">{tr("Hemolyzed", "انحلال دم")}</option>
          <option value="CLOTTED">{tr("Clotted", "متخثرة")}</option>
          <option value="LIPEMIC">{tr("Lipemic", "دهنية")}</option>
          <option value="ICTERIC">{tr("Icteric", "يرقانية")}</option>
          <option value="LEAKING">{tr("Leaking", "تسرب")}</option>
          <option value="CONTAMINATED">{tr("Contaminated", "ملوثة")}</option>
          <option value="OTHER">{tr("Other", "أخرى")}</option>
        </select></label>
        <label>{tr("Expected container", "الحاوية المتوقعة")}<input value={expectedContainerCode || "—"} readOnly /></label>
        <label>{tr("Observed container code", "رمز الحاوية الملاحظة")}<input name="observedContainerCode" maxLength={80} defaultValue={expectedContainerCode || ""} /></label>
        <label>{tr("Temperature °C", "درجة الحرارة °م")}<input name="temperatureC" type="number" min="-100" max="100" step="0.01" /></label>
        <label className="form-span">{tr("Discrepancy details", "تفاصيل التباين")}<textarea name="discrepancyText" rows={2} maxLength={1000} placeholder={tr("Required when label, condition or container does not match.", "مطلوبة عند اختلاف الملصق أو حالة العينة أو الحاوية.")} /></label>
        <label className="form-span">{tr("Reception notes", "ملاحظات الاستلام")}<textarea name="receptionNotes" rows={2} maxLength={1000} /></label>
      </>}

      {mode === "REJECT" && <>
        <label>{tr("Rejection scope", "نطاق الرفض")}<select name="scope" value={rejectionScope} onChange={event => setRejectionScope(event.target.value as "WHOLE_SPECIMEN" | "SELECTED_TESTS")}>
          <option value="WHOLE_SPECIMEN">{tr("Whole specimen", "العينة كاملة")}</option>
          <option value="SELECTED_TESTS">{tr("Selected tests only", "فحوصات محددة فقط")}</option>
        </select></label>
        <label>{tr("Rejection reason", "سبب الرفض")}<select name="rejectionReasonId" required defaultValue="">
          <option value="">{tr("Select reason…", "اختر السبب…")}</option>
          {rejectionReasons.map(reason => <option key={reason.id} value={reason.id}>{reason.code} — {reason.name}</option>)}
        </select></label>

        {rejectionScope === "SELECTED_TESTS" && <fieldset className="form-span">
          <legend>{tr("Affected tests", "الفحوصات المتأثرة")}</legend>
          <div className="permission-grid">
            {orderItems.map(item => <label key={item.id} className="checkbox-row">
              <input type="checkbox" name="orderItemIds" value={item.id} />
              <span><strong>{item.code}</strong> — {item.name}</span>
            </label>)}
          </div>
        </fieldset>}

        <label className="form-span">{tr("Rejection details", "تفاصيل الرفض")}<textarea name="reasonDetails" rows={2} maxLength={1000} required /></label>
      </>}

      <div className="form-span specimen-form-actions">
        <button className="secondary-button" type="button" onClick={() => { setMode(null); setRejectionScope("WHOLE_SPECIMEN"); }}>{tr("Cancel", "إلغاء")}</button>
        <button className={mode === "REJECT" ? "danger-button" : "primary-button"} disabled={busy || (mode === "REJECT" && rejectionReasons.length === 0)}>
          {busy ? tr("Saving…", "جارٍ الحفظ…") : tr(mode, mode === "COLLECT" ? "جمع" : mode === "RECEIVE" ? "استلام" : "رفض")}
        </button>
      </div>
    </form>}
  </div>;
}
