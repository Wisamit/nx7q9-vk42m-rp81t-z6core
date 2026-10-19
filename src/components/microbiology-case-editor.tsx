"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type OrganismOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
type AntibioticOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
type IsolateOption = { id: string; sequenceNumber: number; organismCode: string; organismName: string };

type Row = {
  key: number;
  antibioticId: string;
  interpretation: "S" | "I" | "R" | "NON_SUSCEPTIBLE" | "UNKNOWN";
  micValue: string;
  micUnit: string;
  zoneDiameterMm: string;
  breakpointSnapshot: string;
};

function emptyRow(key: number): Row {
  return { key, antibioticId: "", interpretation: "UNKNOWN", micValue: "", micUnit: "", zoneDiameterMm: "", breakpointSnapshot: "" };
}

export function MicrobiologyCaseEditor({
  caseId,
  cultureStatus,
  preliminaryComment,
  organisms,
  antibiotics,
  isolates,
  locale,
}: {
  caseId: string;
  cultureStatus: string;
  preliminaryComment: string;
  organisms: OrganismOption[];
  antibiotics: AntibioticOption[];
  isolates: IsolateOption[];
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [editor, setEditor] = useState<"culture" | "observation" | "isolate" | null>(null);
  const [selectedIsolateId, setSelectedIsolateId] = useState(isolates[0]?.id || "");
  const [rows, setRows] = useState<Row[]>([emptyRow(1)]);

  async function postJson(url: string, payload: unknown, busyKey: string) {
    if (busy) return null;
    setBusy(busyKey);
    setMessage("");
    setErrorMessage("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const messageByError: Record<string, string> = {
          microbiology_case_state_changed: tr("Another operator changed this culture. Refresh before editing.", "عدّل مستخدم آخر هذه الزراعة. حدّث الصفحة قبل المتابعة."),
          microbiology_case_locked: tr("This microbiology case is finalized or cancelled.", "حالة الأحياء الدقيقة نهائية أو ملغاة."),
          microbiology_result_submitted_withdraw_before_edit: tr("A final result was submitted. Withdraw it for correction before changing culture or susceptibility data.", "تم إرسال النتيجة النهائية. اسحبها للتصحيح قبل تعديل الزرع أو الحساسية."),
          specimen_not_ready_for_microbiology: tr("The specimen is unavailable at this performing branch, quarantined or transferred.", "العينة غير متاحة في فرع التنفيذ أو محجورة أو منقولة."),
          no_growth_conflicts_with_isolates: tr("No-growth cannot be selected while isolates are recorded.", "لا يمكن اختيار عدم وجود نمو مع وجود عزلات مسجلة."),
          invalid_susceptibility_value: tr("Check the AST interpretation, MIC/zone precision and MIC unit.", "تحقق من تفسير الحساسية ودقة قيم MIC/القطر ووحدة MIC."),
          microbiology_ast_catalog_changed: tr("Organism or antibiotic configuration changed. Refresh and retry.", "تغيرت إعدادات الكائن أو المضاد الحيوي. حدّث الصفحة وأعد المحاولة."),
        };
        setErrorMessage(messageByError[body.error] ||
          tr("The microbiology action could not be saved. Refresh if data changed.", "تعذر حفظ إجراء الأحياء الدقيقة. حدّث الصفحة إذا تغيرت البيانات."));
        return null;
      }
      router.refresh();
      return body;
    } catch {
      setErrorMessage(tr("Connection failed; check the latest case state before retrying.",
        "فشل الاتصال؛ راجع أحدث حالة للزرع قبل إعادة المحاولة."));
      return null;
    } finally {
      setBusy("");
    }
  }

  async function updateCulture(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await postJson("/api/microbiology/cases/" + caseId, {
      cultureStatus: form.get("cultureStatus"),
      preliminaryComment: form.get("preliminaryComment"),
      markPreliminary: form.get("markPreliminary") === "on",
    }, "culture");
    if (result) {
      setEditor(null);
      setMessage(tr("Culture status updated.", "تم تحديث حالة الزرع."));
    }
  }

  async function addObservation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await postJson("/api/microbiology/cases/" + caseId + "/observations", {
      observationType: form.get("observationType"),
      observationText: form.get("observationText"),
    }, "observation");
    if (result) {
      formElement.reset();
      setEditor(null);
      setMessage(tr("Observation added.", "تمت إضافة الملاحظة."));
    }
  }

  async function addIsolate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await postJson("/api/microbiology/cases/" + caseId + "/isolates", {
      organismId: form.get("organismId"),
      quantityText: form.get("quantityText"),
      colonyNotes: form.get("colonyNotes"),
    }, "isolate");
    if (result) {
      formElement.reset();
      setEditor(null);
      setMessage(tr("Isolate added.", "تمت إضافة العزلة."));
    }
  }

  function updateRow(key: number, patch: Partial<Row>) {
    setRows(current => current.map(row => row.key === key ? { ...row, ...patch } : row));
  }

  async function addSusceptibility(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedIsolateId) {
      setMessage(tr("Select an isolate first.", "اختر عزلة أولًا."));
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const activeRows = rows.filter(row => row.antibioticId);
    if (activeRows.length === 0) {
      setMessage(tr("Add at least one antibiotic result.", "أضف نتيجة مضاد حيوي واحدة على الأقل."));
      return;
    }

    const result = await postJson("/api/microbiology/isolates/" + selectedIsolateId + "/susceptibility", {
      method: form.get("method"),
      comments: form.get("comments"),
      results: activeRows.map(row => ({
        antibioticId: row.antibioticId,
        interpretation: row.interpretation,
        micValue: row.micValue || null,
        micUnit: row.micUnit,
        zoneDiameterMm: row.zoneDiameterMm || null,
        breakpointSnapshot: row.breakpointSnapshot,
      })),
    }, "susceptibility");
    if (result) {
      setRows([emptyRow(1)]);
      formElement.reset();
      setMessage(tr("Susceptibility panel recorded.", "تم تسجيل لوحة الحساسية."));
    }
  }

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>{tr("Culture Status", "حالة الزرع")}</h2>
      <button type="button" className="primary-button" disabled={busy !== ""}
        onClick={() => { setErrorMessage(""); setMessage(""); setEditor("culture"); }}>
        {tr("Update Culture Status", "تحديث حالة الزرع")}
      </button>
      <CrudModal open={editor === "culture"} onClose={() => { if (!busy) setEditor(null); }}
        size="compact"
        title={tr("Update Culture Status", "تحديث حالة الزرع")}
        description={tr("Culture status and preliminary classification affect specimen interpretation. Review patient and isolate context before saving.", "تؤثر حالة الزرع والتصنيف الأولي على تفسير العينة؛ راجع سياق المريض والعزلات قبل الحفظ.")}>
        {editor === "culture" && <form className="catalog-form" onSubmit={updateCulture}>
        <label>{tr("Status", "الحالة")}<select name="cultureStatus" defaultValue={cultureStatus}>
          <option value="PENDING">{tr("Pending", "قيد الانتظار")}</option>
          <option value="NO_GROWTH">{tr("No growth", "لا يوجد نمو")}</option>
          <option value="GROWTH">{tr("Growth", "نمو")}</option>
          <option value="MIXED_GROWTH">{tr("Mixed growth", "نمو مختلط")}</option>
          <option value="CONTAMINATED">{tr("Contaminated", "ملوث")}</option>
        </select></label>
        <label className="form-span">{tr("Preliminary comment", "تعليق أولي")}<textarea name="preliminaryComment" rows={3} defaultValue={preliminaryComment} /></label>
        <label className="check-line form-span"><input type="checkbox" name="markPreliminary" /> {tr("Mark case as PRELIMINARY", "تعيين الحالة كأولية")}</label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "culture" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Culture Status", "حفظ حالة الزرع")}</button>
      </form>}
        {editor === "culture" && errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
      </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Add Observation", "إضافة ملاحظة")}</h2>
      <button type="button" className="primary-button" disabled={busy !== ""}
        onClick={() => { setErrorMessage(""); setMessage(""); setEditor("observation"); }}>
        {tr("Add Microbiology Observation", "إضافة ملاحظة أحياء دقيقة")}
      </button>
      <CrudModal open={editor === "observation"} onClose={() => { if (!busy) setEditor(null); }}
        size="compact"
        title={tr("Add Microbiology Observation", "إضافة ملاحظة أحياء دقيقة")}
        description={tr("Observations are recorded against the current culture and performing specimen; history remains traceable.", "تُسجّل الملاحظة ضمن الزرع والعينة المنفذة، ويبقى تاريخ التعديلات قابلاً للتتبع.")}>
        {editor === "observation" && <form className="catalog-form" onSubmit={addObservation}>
        <label>{tr("Type", "النوع")}<select name="observationType" defaultValue="GRAM_STAIN">
          <option value="GRAM_STAIN">{tr("Gram stain", "صبغة غرام")}</option>
          <option value="MICROSCOPY">{tr("Microscopy", "فحص مجهري")}</option>
          <option value="CULTURE">{tr("Culture observation", "ملاحظة زرع")}</option>
          <option value="COLONY_COUNT">{tr("Colony count", "عدد المستعمرات")}</option>
          <option value="OTHER">{tr("Other", "أخرى")}</option>
        </select></label>
        <label className="form-span">{tr("Observation", "الملاحظة")}<textarea name="observationText" rows={4} required /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "observation" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Observation", "إضافة الملاحظة")}</button>
      </form>}
        {editor === "observation" && errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
      </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Add Isolate", "إضافة عزلة")}</h2>
      <button type="button" className="primary-button" disabled={busy !== ""}
        onClick={() => { setErrorMessage(""); setMessage(""); setEditor("isolate"); }}>
        {tr("Add Microbiology Isolate", "إضافة عزلة أحياء دقيقة")}
      </button>
      <CrudModal open={editor === "isolate"} onClose={() => { if (!busy) setEditor(null); }}
        size="compact"
        title={tr("Add Microbiology Isolate", "إضافة عزلة أحياء دقيقة")}
        description={tr("Choose the catalogued organism and observed growth only; susceptibility testing is a separate reviewed workflow.", "اختر الكائن المعرّف والنمو الملاحظ فقط؛ فحص الحساسية مسار مستقل يحتاج مراجعة.")}>
        {editor === "isolate" && <form className="catalog-form" onSubmit={addIsolate}>
        <label>{tr("Organism", "الكائن الدقيق")}<select name="organismId" required defaultValue="">
          <option value="">{tr("Select organism…", "اختر الكائن الدقيق…")}</option>
          {organisms.map(item => <option key={item.id} value={item.id}>{item.code} — {locale === "ar" ? item.nameAr || item.nameEn : item.nameEn}</option>)}
        </select></label>
        <label>{tr("Quantity / growth", "الكمية / النمو")}<input name="quantityText" placeholder={tr("e.g. Heavy growth / 10^5 CFU/mL","مثال: نمو كثيف / 10^5 CFU/mL")} /></label>
        <label className="form-span">{tr("Colony notes", "ملاحظات المستعمرات")}<textarea name="colonyNotes" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== "" || organisms.length === 0}>{busy === "isolate" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Isolate", "إضافة العزلة")}</button>
      </form>}
        {editor === "isolate" && errorMessage && <p className="form-error" role="alert">{errorMessage}</p>}
      </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Susceptibility Panel", "لوحة الحساسية")}</h2>
      <form className="catalog-form" onSubmit={addSusceptibility}>
        <label>{tr("Isolate", "العزلة")}<select value={selectedIsolateId} onChange={event => setSelectedIsolateId(event.target.value)} required>
          <option value="">{tr("Select isolate…", "اختر العزلة…")}</option>
          {isolates.map(item => <option key={item.id} value={item.id}>#{item.sequenceNumber} · {item.organismCode} — {item.organismName}</option>)}
        </select></label>
        <label>{tr("Method", "الطريقة")}<input name="method" placeholder={tr("Disk diffusion / MIC / automated","الانتشار بالقرص / MIC / آلي")} /></label>

        <div className="form-span">
          {rows.map(row => <div className="catalog-form" key={row.key}>
            <label>{tr("Antibiotic", "المضاد الحيوي")}<select value={row.antibioticId} onChange={event => updateRow(row.key, { antibioticId: event.target.value })}>
              <option value="">{tr("Select antibiotic…", "اختر المضاد الحيوي…")}</option>
              {antibiotics.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}
            </select></label>
            <label>{tr("Interpretation", "التفسير")}<select value={row.interpretation} onChange={event => updateRow(row.key, { interpretation: event.target.value as Row["interpretation"] })}>
              <option value="S">S</option><option value="I">I</option><option value="R">R</option><option value="NON_SUSCEPTIBLE">{tr("Non-susceptible", "غير حساس")}</option><option value="UNKNOWN">{tr("Unknown", "غير معروف")}</option>
            </select></label>
            <label>MIC<input inputMode="decimal" value={row.micValue} onChange={event => updateRow(row.key, { micValue: event.target.value })} /></label>
            <label>{tr("MIC unit", "وحدة MIC")}<input value={row.micUnit} onChange={event => updateRow(row.key, { micUnit: event.target.value })} /></label>
            <label>{tr("Zone (mm)", "القطر (مم)")}<input inputMode="decimal" value={row.zoneDiameterMm} onChange={event => updateRow(row.key, { zoneDiameterMm: event.target.value })} /></label>
            <label>{tr("Breakpoint snapshot", "حد التفسير المحفوظ")}<input value={row.breakpointSnapshot} onChange={event => updateRow(row.key, { breakpointSnapshot: event.target.value })} /></label>
            {rows.length > 1 && <button className="secondary-button form-span" type="button" onClick={() => setRows(current => current.filter(item => item.key !== row.key))}>{tr("Remove Row", "حذف الصف")}</button>}
          </div>)}
          <button className="secondary-button" type="button" onClick={() => setRows(current => [...current, emptyRow(Math.max(...current.map(item => item.key), 0) + 1)])}>{tr("Add Antibiotic Row", "إضافة مضاد حيوي")}</button>
        </div>

        <label className="form-span">{tr("Comments", "التعليقات")}<textarea name="comments" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== "" || isolates.length === 0 || antibiotics.length === 0}>{busy === "susceptibility" ? tr("Saving…", "جارٍ الحفظ…") : tr("Save Susceptibility Panel", "حفظ لوحة الحساسية")}</button>
      </form>
    </article>

    {message && <p className="form-success form-span" role="status">{message}</p>}
    {errorMessage && !editor && <p className="form-error form-span" role="alert">{errorMessage}</p>}
  </section>;
}
