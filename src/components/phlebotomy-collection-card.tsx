"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type BranchOption = { id: string; code: string; name: string };
type SecondaryOption = { value: string; label: string };

export function PhlebotomyCollectionCard({
  specimen,
  branches,
  activeBranchId,
  locale,
}: {
  specimen: {
    id: string;
    orderId: string;
    homeCollectionVisitId: string | null;
    homeAddressSnapshot: string | null;
    barcode: string;
    accessionNumber: string;
    patientNumber: string;
    patientName: string;
    specimenName: string;
    containerName: string;
    testCodes: string[];
    requiredVolume: string | null;
    requiredVolumeUnit: string | null;
    patientPreparation: string[];
    collectionInstructions: string[];
    requirementsFinalized: boolean;
    configurationComplete: boolean;
    parentBarcode: string | null;
    secondaryOptions: SecondaryOption[];
  };
  branches: BranchOption[];
  activeBranchId: string | null;
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [outcome, setOutcome] = useState<"SUCCESS" | "FAILED">("SUCCESS");
  const [secondaryType, setSecondaryType] = useState(specimen.secondaryOptions[0]?.value || "PATIENT_NUMBER");
  const [locationType, setLocationType] = useState<"BRANCH" | "HOME" | "OTHER">(specimen.homeCollectionVisitId ? "HOME" : "BRANCH");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [isError, setIsError] = useState(false);
  const [message, setMessage] = useState("");

  function errorMessage(code: string) {
    const messages: Record<string, string> = {
      patient_name_verification_failed: tr("Patient name did not match the order record.", "اسم المريض لا يطابق سجل الطلب."),
      patient_secondary_verification_failed: tr("The second patient identifier did not match.", "المعرّف الثاني للمريض غير مطابق."),
      invalid_secondary_verification_type: tr("Select a valid second patient identifier.", "اختر معرّفًا ثانيًا صالحًا للمريض."),
      secondary_verification_required: tr("Enter the second patient identifier.", "أدخل المعرّف الثاني للمريض."),
      specimen_requirements_not_finalized: tr("This specimen has no immutable order-time requirement snapshot. Collection is blocked.", "لا تحتوي هذه العينة على لقطة ثابتة لمتطلبات وقت الطلب. تم منع السحب."),
      order_time_specimen_requirement_snapshot_missing: tr("Historical requirements were not captured at order registration. Current catalog values will not be substituted.", "لم تُحفظ المتطلبات التاريخية عند تسجيل الطلب. لن يتم استبدالها بقيم الدليل الحالية."),
      specimen_requirement_configuration_incomplete: tr("Collection is blocked because specimen requirements are incomplete.", "السحب متوقف لأن متطلبات العينة غير مكتملة."),
      specimen_not_collectable: tr("This specimen is no longer available for collection.", "هذه العينة لم تعد متاحة للسحب."),
      specimen_type_required_before_collection: tr("A specimen type must be configured before collection.", "يجب تهيئة نوع العينة قبل السحب."),
      specimen_volume_required: tr("Collected volume is required.", "حجم العينة المسحوبة مطلوب."),
      specimen_volume_unit_mismatch: tr("Volume unit must match the planned requirement.", "يجب أن تطابق وحدة الحجم المتطلب المخطط."),
      insufficient_specimen_volume: tr("Collected volume is below the required minimum.", "الحجم المسحوب أقل من الحد الأدنى المطلوب."),
      invalid_volume: tr("Enter a valid collected volume.", "أدخل حجمًا صحيحًا للعينة."),
      invalid_collection_location_type: tr("Select a valid collection location type.", "اختر نوع موقع سحب صالحًا."),
      collection_location_details_required: tr("Describe the home or other collection location.", "أدخل وصف موقع السحب المنزلي أو الموقع الآخر."),
      invalid_failed_collection_reason: tr("Select a valid failed-collection reason.", "اختر سببًا صالحًا لفشل السحب."),
      failed_collection_reason_required: tr("Failed collection reason is required.", "سبب فشل السحب مطلوب."),
      failed_collection_details_required: tr("Document the failed collection details.", "وثّق تفاصيل فشل السحب."),
      specimen_preanalytical_state_changed: tr("Specimen state changed. Refresh and review before retrying.", "تغيرت حالة العينة. حدّث الصفحة وراجعها قبل إعادة المحاولة."),
      collection_branch_must_match_specimen_location: tr("Collection must be recorded at the specimen's planned custody branch.", "يجب تسجيل السحب في فرع الحيازة المخطط للعينة."),
      order_cancelled: tr("The order is cancelled.", "الطلب ملغى."),
      home_collection_visit_custody_required: tr("An assigned, active home collection visit is required. Open the linked visit and start collection before scanning.", "يجب وجود زيارة سحب منزلي فعالة ومخصصة لك. افتح الزيارة وابدأ السحب قبل تسجيل العينة."),
    };
    return messages[code] || code || tr("Collection action failed.", "فشل إجراء السحب.");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    submitting.current = true;
    setBusy(true);
    setMessage("");
    setIsError(false);
    try {
    const response = await fetch(`/api/specimens/${specimen.id}/collection-attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        outcome,
        branchId: form.get("branchId"),
        patientName: form.get("patientName"),
        secondaryVerificationType: secondaryType,
        secondaryVerificationValue: form.get("secondaryVerificationValue"),
        collectionLocationType: locationType,
        homeCollectionVisitId: specimen.homeCollectionVisitId,
        collectionLocationText: form.get("collectionLocationText"),
        volume: form.get("volume"),
        volumeUnit: form.get("volumeUnit"),
        failureReasonCode: form.get("failureReasonCode"),
        failureReasonText: form.get("failureReasonText"),
        notes: form.get("notes"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(outcome === "SUCCESS"
        ? tr("Collection recorded successfully.", "تم تسجيل سحب العينة بنجاح.")
        : `${tr("Failed attempt recorded. New recollection barcode", "تم تسجيل محاولة السحب الفاشلة. باركود إعادة السحب الجديد")}: ${body.replacementBarcode || "—"}`);
      formElement.reset();
      setOutcome("SUCCESS");
      setLocationType(specimen.homeCollectionVisitId ? "HOME" : "BRANCH");
      setSecondaryType(specimen.secondaryOptions[0]?.value || "PATIENT_NUMBER");
      router.refresh();
    } else {
      setIsError(true);
      setMessage(errorMessage(body.error || ""));
    }
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Scan and verify the specimen state before recording another collection attempt.",
        "انقطع الاتصال. امسح باركود العينة وتحقق من حالتها قبل تسجيل محاولة سحب أخرى.",
      ));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <section className="detail-card specimen-card" id={`specimen-${specimen.id}`}>
    <div className="specimen-card-head">
      <div>
        <p className="eyebrow">{tr("Collection candidate", "عينة جاهزة للسحب")}</p>
        <h2 className="barcode-text">{specimen.barcode}</h2>
        <p className="muted">{specimen.accessionNumber} · {specimen.patientNumber} · {specimen.patientName}</p>
      </div>
      <div className="header-actions">
        {specimen.requirementsFinalized && specimen.configurationComplete && <Link className="secondary-link" href={`/specimens/${specimen.id}/label`}>{tr("Print Label", "طباعة الملصق")}</Link>}
        <Link className="secondary-link" href={`/orders/${specimen.orderId}`}>{tr("Open Order", "فتح الطلب")}</Link>
      </div>
    </div>

    <div className="specimen-metadata">
      <div><span>{tr("Specimen", "العينة")}</span><strong>{specimen.specimenName}</strong></div>
      <div><span>{tr("Container", "الحاوية")}</span><strong>{specimen.containerName}</strong></div>
      <div><span>{tr("Tests", "الفحوصات")}</span><strong>{specimen.testCodes.join(", ") || "—"}</strong></div>
      <div><span>{tr("Required volume", "الحجم المطلوب")}</span><strong>{specimen.requiredVolume ? `${specimen.requiredVolume} ${specimen.requiredVolumeUnit || ""}` : tr("Not specified", "غير محدد")}</strong></div>
      <div><span>{tr("Lineage", "التسلسل")}</span><strong>{specimen.parentBarcode ? `${tr("Recollection after", "إعادة سحب بعد")} ${specimen.parentBarcode}` : tr("Primary specimen", "عينة أصلية")}</strong></div>
      <div><span>{tr("Requirements", "المتطلبات")}</span><strong>{specimen.requirementsFinalized ? tr("Finalized", "مثبتة") : tr("Not finalized", "غير مثبتة")}</strong></div>
    </div>

    {specimen.patientPreparation.length > 0 && <div className="form-warning">
      <strong>{tr("Patient preparation", "تحضير المريض")}</strong>
      <span>{specimen.patientPreparation.join(" · ")}</span>
    </div>}

    {specimen.collectionInstructions.length > 0 && <div className="form-warning">
      <strong>{tr("Collection instructions", "تعليمات السحب")}</strong>
      <span>{specimen.collectionInstructions.join(" · ")}</span>
    </div>}

    {!specimen.requirementsFinalized ? <div className="form-error">
      <strong>{tr("Collection blocked", "السحب متوقف")}</strong>
      <span>{tr(
        "This historical specimen has no immutable requirement snapshot captured at order registration. Current catalog values are intentionally not substituted.",
        "هذه العينة التاريخية لا تحتوي على لقطة ثابتة للمتطلبات محفوظة عند تسجيل الطلب. لا يتم استبدالها بقيم الدليل الحالية بشكل مقصود."
      )}</span>
    </div> : !specimen.configurationComplete ? <div className="form-error">
      <strong>{tr("Collection blocked", "السحب متوقف")}</strong>
      <span>{tr("The order-time specimen requirement snapshot is incomplete. Correct the catalog/order through a controlled workflow before collection.", "لقطة متطلبات العينة وقت الطلب غير مكتملة. صحح الدليل/الطلب عبر مسار منضبط قبل السحب.")}</span>
    </div> : <form className="catalog-form" onSubmit={submit}>
      <fieldset className="form-span">
        <legend>{tr("Patient verification — two identifiers required", "التحقق من المريض — مطلوب معرفان")}</legend>
        <div className="catalog-form">
          <label>{tr("Patient full name", "الاسم الكامل للمريض")}<input name="patientName" autoComplete="off" maxLength={220} required /></label>
          <label>{tr("Second identifier", "المعرّف الثاني")}<select value={secondaryType} onChange={event => setSecondaryType(event.target.value)} required>
            {specimen.secondaryOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select></label>
          <label className="form-span">{tr("Enter second identifier", "أدخل المعرّف الثاني")}<input
            name="secondaryVerificationValue"
            type={secondaryType === "DATE_OF_BIRTH" ? "date" : "text"}
            autoComplete="off"
            maxLength={160}
            required
          /></label>
        </div>
      </fieldset>

      <label>{tr("Collection branch", "فرع السحب")}<select name="branchId" defaultValue={activeBranchId || branches[0]?.id || ""} required>
        {branches.map(branch => <option value={branch.id} key={branch.id}>{branch.code} — {branch.name}</option>)}
      </select></label>
      <label>{tr("Collection location type", "نوع موقع السحب")}<select value={locationType} disabled={Boolean(specimen.homeCollectionVisitId)} onChange={event => setLocationType(event.target.value as "BRANCH" | "HOME" | "OTHER")}>
        <option value="BRANCH">{tr("Laboratory branch", "فرع المختبر")}</option>
        <option value="HOME">{tr("Home collection", "سحب منزلي")}</option>
        <option value="OTHER">{tr("Other location", "موقع آخر")}</option>
      </select></label>
      <label className="form-span">{tr(locationType === "BRANCH" ? "Room / chair (optional)" : "Location details", locationType === "BRANCH" ? "الغرفة / كرسي السحب (اختياري)" : "تفاصيل الموقع")}
        <input name="collectionLocationText" maxLength={250} defaultValue={specimen.homeAddressSnapshot || ""} required={locationType !== "BRANCH"} />
      </label>

      <fieldset className="form-span">
        <legend>{tr("Collection outcome", "نتيجة محاولة السحب")}</legend>
        <div className="specimen-action-buttons">
          <button type="button" className={outcome === "SUCCESS" ? "primary-button" : "secondary-button"} onClick={() => setOutcome("SUCCESS")}>{tr("Successful collection", "سحب ناجح")}</button>
          <button type="button" className={outcome === "FAILED" ? "danger-button" : "secondary-button"} onClick={() => setOutcome("FAILED")}>{tr("Failed collection", "فشل السحب")}</button>
        </div>
      </fieldset>

      {outcome === "SUCCESS" ? <>
        <label>{tr("Collected volume", "الحجم المسحوب")}<input name="volume" type="number" step="0.001" min={specimen.requiredVolume || "0"} required={Boolean(specimen.requiredVolume)} /></label>
        <label>{tr("Volume unit", "وحدة الحجم")}<input name="volumeUnit" maxLength={30} defaultValue={specimen.requiredVolumeUnit || ""} readOnly={Boolean(specimen.requiredVolumeUnit)} required={Boolean(specimen.requiredVolumeUnit)} /></label>
      </> : <>
        <label>{tr("Failure reason", "سبب فشل السحب")}<select name="failureReasonCode" defaultValue="" required>
          <option value="">{tr("Select reason…", "اختر السبب…")}</option>
          <option value="NO_VENOUS_ACCESS">{tr("Unable to obtain venous access", "تعذر الوصول الوريدي")}</option>
          <option value="PATIENT_REFUSED">{tr("Patient refused collection", "المريض رفض السحب")}</option>
          <option value="PATIENT_UNAVAILABLE">{tr("Patient unavailable", "المريض غير متاح")}</option>
          <option value="PATIENT_UNWELL">{tr("Patient became unwell", "المريض أصبح متوعكًا")}</option>
          <option value="COLLECTION_INTERRUPTED">{tr("Collection interrupted", "تم إيقاف السحب")}</option>
          <option value="EQUIPMENT_SUPPLY_ISSUE">{tr("Equipment / supply issue", "مشكلة معدات / مستلزمات")}</option>
          <option value="OTHER">{tr("Other", "أخرى")}</option>
        </select></label>
        <label className="form-span">{tr("Failure details", "تفاصيل فشل السحب")}<textarea name="failureReasonText" rows={2} maxLength={1000} required /></label>
      </>}

      <label className="form-span">{tr("Collection notes", "ملاحظات السحب")}<textarea name="notes" rows={2} maxLength={1000} /></label>
      <div className="form-span specimen-form-actions">
        <button className={outcome === "FAILED" ? "danger-button" : "primary-button"} disabled={busy}>
          {busy ? tr("Saving…", "جارٍ الحفظ…") : outcome === "SUCCESS" ? tr("Record Collection", "تسجيل السحب") : tr("Record Failed Attempt", "تسجيل المحاولة الفاشلة")}
        </button>
      </div>
      {message && <div className="form-success form-span">{message}</div>}
    </form>}
  </section>;
}
