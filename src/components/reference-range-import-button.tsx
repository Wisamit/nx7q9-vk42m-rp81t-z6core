"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { compareReferenceImportPreview } from "@/lib/reference-import-preview-guard";
import { useRouter } from "next/navigation";

type TestSuggestion = { id: string; code: string; nameEn: string; nameAr?: string | null; score: number };
type UnitSuggestion = { id: string; code: string; symbol: string; score: number };
type DetailItem = { value: string; count: number; suggestion?: TestSuggestion | UnitSuggestion | null; candidates?: Array<TestSuggestion | UnitSuggestion> };
type TestOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
type UnitOption = { id: string; code: string; symbol: string };
type Preview = {
  total: number;
  safe: number;
  review: number;
  reasons: Record<string, number>;
  generatedTestsRemaining?: number;
  details?: {
    unmatchedTests: DetailItem[];
    unmappedUnits: DetailItem[];
    unitConflicts: DetailItem[];
    emptyIntervals: DetailItem[];
  };
  testOptions?: TestOption[];
  unitOptions?: UnitOption[];
};

export function ReferenceRangeImportButton({ batchId, locale }: { batchId: string; locale: "ar" | "en" }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [mappingBusy, setMappingBusy] = useState("");
  const [mappingTargets, setMappingTargets] = useState<Record<string, string>>({});
  const [mappingSearch, setMappingSearch] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [resolving, setResolving] = useState(false);
  const [reviewAction, setReviewAction] = useState<"RESOLVE" | "IMPORT" | null>(null);
  const [reviewSnapshot, setReviewSnapshot] = useState<Preview | null>(null);
  const [reviewError, setReviewError] = useState("");
  const [reviewRetryBlocked, setReviewRetryBlocked] = useState(false);
  const inFlight = useRef(false);
  const mappingInFlight = useRef(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const testName = (test: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? test.nameAr || test.nameEn : test.nameEn;
  const reasonLabel = (value: string) => ({
    TEST_NOT_FOUND: tr("Test not found", "الفحص غير موجود"),
    AMBIGUOUS_TEST_MATCH: tr("Ambiguous test match", "مطابقة الفحص ملتبسة"),
    UNIT_NOT_MAPPED: tr("Unit not mapped", "الوحدة غير مربوطة"),
    UNIT_MISSING_NO_TEST_DEFAULT: tr("Unit missing and test has no default", "الوحدة مفقودة ولا توجد وحدة افتراضية للفحص"),
    SEX_NOT_MAPPED: tr("Sex not mapped", "الجنس غير قابل للربط"),
    AGE_UNIT_NOT_MAPPED: tr("Age unit not mapped", "وحدة العمر غير قابلة للربط"),
    EMPTY_REFERENCE_INTERVAL: tr("Empty reference interval", "مدى مرجعي فارغ"),
    MULTI_COMPONENT_TEST_REQUIRES_REVIEW: tr("Multi-component test requires review", "الفحص متعدد المكونات يحتاج مراجعة"),
    COMPONENT_UNIT_CONFLICT: tr("Component unit conflict", "تعارض وحدة المكوّن"),
    TEST_UNIT_CONFLICT: tr("Test unit conflict", "تعارض وحدة الفحص"),
  }[value] || value);

  async function loadPreview() {
    const response = await fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    setPreview(data);
    return data as Preview;
  }

  useEffect(() => {
    let active = true;
    fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setPreview(data); })
      .catch(() => { if (active) setPreview(null); });
    return () => { active = false; };
  }, [batchId]);

  function openReview(action: "RESOLVE" | "IMPORT") {
    if (!preview || busy || resolving || mappingBusy || mappingInFlight.current || inFlight.current) return;
    if (action === "IMPORT" && preview.safe < 1) return;
    if (action === "RESOLVE" && preview.safe < 1 && !(preview.generatedTestsRemaining || 0)) return;
    setReviewSnapshot(preview);
    setReviewError("");
    setReviewRetryBlocked(false);
    setReviewAction(action);
    setMessage("");
  }

  async function confirmReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const action = reviewAction;
    const snapshot = reviewSnapshot;
    if (!action || !snapshot || inFlight.current || mappingInFlight.current || busy || resolving || mappingBusy || reviewRetryBlocked) return;
    inFlight.current = true;
    setBusy(true);
    if (action === "RESOLVE") setResolving(true);
    setReviewError("");
    let mutationStarted = false;
    try {
      // The preview is not a transaction lock. Refuse a changed estimate and
      // require a fresh explicit review before any server-side mutation.
      const response = await fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { cache: "no-store" });
      if (!response.ok) throw new Error(tr("Could not recheck the live import preview.", "تعذر التحقق من معاينة الاستيراد الحالية."));
      const live = await response.json() as Preview;
      const comparison = compareReferenceImportPreview(snapshot, live);
      if (comparison === "invalid") {
        throw new Error(tr("Invalid import preview. No changes submitted.", "معاينة الاستيراد غير صالحة؛ لم تُرسل تغييرات."));
      }
      if (comparison === "changed") {
        setPreview(live);
        setReviewSnapshot(live);
        setReviewError(tr(
          "The import preview changed. Review the updated counts, then explicitly confirm again.",
          "تغيرت معاينة الاستيراد. راجع الأعداد الجديدة ثم أكد من جديد.",
        ));
        return;
      }
      if (action === "IMPORT" && live.safe < 1) return;
      if (action === "RESOLVE" && live.safe < 1 && !(live.generatedTestsRemaining || 0)) return;

      if (action === "RESOLVE") {
        if ((live.generatedTestsRemaining || 0) > 0) {
          mutationStarted = true;
          const masters = await fetch(`/api/catalog/imports/${batchId}/commit`, { method: "POST" });
          if (!masters.ok) throw new Error(tr("Safe master recovery failed.", "فشل استرجاع البيانات الأساسية الآمنة."));
        }
        mutationStarted = true;
        const units = await fetch(`/api/catalog/imports/${batchId}/prepare-units`, { method: "POST" });
        if (!units.ok) throw new Error(tr("Legacy unit preparation failed.", "فشل تجهيز وحدات النظام القديم."));
        const ranges = await fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { method: "POST" });
        const body = await ranges.json().catch(() => ({})) as { imported?: number; review?: number };
        if (!ranges.ok) throw new Error(tr("Reference interval preparation failed.", "فشل تجهيز المديات المرجعية."));
        setMessage(tr(
          `Resolved ${body.imported || 0} additional inactive reference intervals; ${body.review || 0} remain for clinical mapping review.`,
          `تم تجهيز ${body.imported || 0} مدى مرجعي إضافي غير نشط؛ بقي ${body.review || 0} للمراجعة السريرية.`,
        ));
      } else {
        mutationStarted = true;
        const result = await fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { method: "POST" });
        const body = await result.json().catch(() => ({})) as { imported?: number; review?: number };
        if (!result.ok) throw new Error(tr("Reference interval import failed.", "فشل استيراد المديات المرجعية."));
        setMessage(tr(
          `Imported ${body.imported || 0} inactive reference intervals pending clinical approval; ${body.review || 0} remain for mapping review.`,
          `تم استيراد ${body.imported || 0} مدى مرجعي غير نشط بانتظار الاعتماد السريري؛ بقي ${body.review || 0} لمراجعة الربط.`,
        ));
      }
      setReviewAction(null);
      await loadPreview();
      router.refresh();
    } catch (error) {
      // Network failures may occur AFTER a POST reached the server, and safe
      // recovery is a multi-endpoint sequence, not one atomic transaction.
      if (mutationStarted) setReviewRetryBlocked(true);
      setReviewError((error instanceof Error ? error.message : tr("Import failed.", "تعذر الاستيراد.")) +
        (mutationStarted ? tr(
          " Some changes may already have been saved. Check batch history and refresh before opening a new review; do not retry this submission blindly.",
          " قد تكون بعض التغييرات حُفظت بالفعل. تحقق من سجل الدفعة وحدّث الصفحة قبل بدء مراجعة جديدة؛ لا تكرر الإرسال دون تحقق.",
        ) : ""));
    } finally {
      setBusy(false);
      setResolving(false);
      inFlight.current = false;
    }
  }

  async function saveMapping(mappingType: "TEST_ALIAS" | "UNIT_ALIAS", sourceValue: string) {
    const mapKey = `${mappingType}:${sourceValue}`;
    if (inFlight.current || mappingInFlight.current || busy || resolving || reviewAction) return;
    const targetId = mappingTargets[mapKey];
    if (!targetId) {
      setMessage(tr("Select a target before saving the mapping.", "اختر الهدف قبل حفظ الربط."));
      return;
    }
    mappingInFlight.current = true;
    setMappingBusy(mapKey);
    setMessage("");
    try {
      const response = await fetch(`/api/catalog/imports/${batchId}/mappings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappingType, sourceValue, targetId }),
      });
      await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(tr("Could not save mapping. Review the batch and try again.", "تعذر حفظ الربط. راجع الدفعة قبل المحاولة مجدداً."));
        return;
      }
      setMessage(tr(`Saved reviewed mapping for "${sourceValue}". Re-analyzed remaining ranges.`,
        `تم حفظ الربط المراجع للقيمة "${sourceValue}" وإعادة تحليل المديات المتبقية.`));
      await loadPreview();
      router.refresh();
    } catch {
      setMessage(tr(
        "Connection interrupted; mapping may have been saved. Refresh and inspect the row before submitting again.",
        "انقطع الاتصال؛ ربما تم حفظ الربط. حدّث السجلات وتحقق من الصف قبل إعادة الإرسال.",
      ));
    } finally {
      mappingInFlight.current = false;
      setMappingBusy("");
    }
  }

  if (!preview) return <span className="muted">{tr("Analyzing reference ranges…", "جارٍ تحليل المديات المرجعية…")}</span>;

  return <div className="range-import-panel">
    <div className="range-import-summary">
      <strong>{tr("Reference ranges:","المديات المرجعية:")}</strong>
      <span>{preview.total} {tr("staged","مرحلي")}</span>
      <span>{preview.safe} {tr("safe","آمن")}</span>
      <span>{preview.review} {tr("review","للمراجعة")}</span>
    </div>

    {((preview.generatedTestsRemaining || 0) > 0 || preview.safe > 0) && <button type="button" className="primary-button" disabled={busy || resolving || Boolean(mappingBusy)} onClick={() => openReview("RESOLVE")}>{resolving ? tr("Resolving…","جارٍ الحل…") : tr("Resolve Safe Legacy Items","حل عناصر النظام القديم الآمنة")}</button>}
    {preview.safe > 0 && <button type="button" className="secondary-button" disabled={busy || resolving || Boolean(mappingBusy)} onClick={() => openReview("IMPORT")}>{busy && !resolving ? tr("Importing ranges…","جارٍ استيراد المديات…") : tr("Import Safe Reference Ranges","استيراد المديات المرجعية الآمنة")}</button>}
    {message && <span className="range-import-message" role="status">{message}</span>}
    <CrudModal open={reviewAction !== null} onClose={() => { if (!inFlight.current && !busy) setReviewAction(null); }}
      size="compact" title={reviewAction === "RESOLVE" ? tr("Review Safe Legacy Resolution", "مراجعة حل عناصر النظام القديم") : tr("Review Reference Interval Import", "مراجعة استيراد المديات المرجعية")}
      description={tr(
        "Clinical legacy import operations require deliberate authorization. Imported reference intervals are inactive pending independent clinical approval.",
        "يتطلب استيراد بيانات المختبر القديمة مراجعة واعية. المديات المرجعية المستوردة تبقى غير نشطة بانتظار اعتماد سريري مستقل.",
      )}>
      {reviewAction && reviewSnapshot && <form className="catalog-form" onSubmit={confirmReview}>
        <p className="form-span">{tr("Import batch", "دفعة الاستيراد")}: <code>{batchId}</code></p>
        <p>{tr("Exact-match intervals", "مديات بمطابقة دقيقة")}: <strong>{reviewSnapshot.safe}</strong></p>
        <p>{tr("Manual-review rows", "صفوف للمراجعة اليدوية")}: <strong>{reviewSnapshot.review}</strong></p>
        <p>{tr("Total candidate rows", "إجمالي الصفوف المرشحة")}: <strong>{reviewSnapshot.total}</strong></p>
        {reviewAction === "RESOLVE" && <p className="form-span">{tr(
          `This sequence may import up to ${reviewSnapshot.generatedTestsRemaining || 0} pending master test records, prepare unit mappings, then add eligible reference intervals. Completed steps cannot be rolled back as a single operation.`,
          `قد تستورد هذه السلسلة حتى ${reviewSnapshot.generatedTestsRemaining || 0} سجلاً أساسياً للفحوص، وتجهز روابط الوحدات، ثم تضيف المديات المؤهلة. الخطوات المكتملة لا تُلغى كعملية واحدة.`,
        )}</p>}
        <p className="form-span muted">{tr(
          "No reference interval is approved or applied to released results by this action. Ambiguous test/unit/context rows remain for expert review.",
          "لا يعتمد هذا الإجراء أي مدى مرجعي ولا يطبقه على نتائج صادرة. تبقى الصفوف الملتبسة في الفحوص أو الوحدات أو السياق للمراجعة المتخصصة.",
        )}</p>
        {reviewError && <p role="alert" className="form-error form-span">{reviewError}</p>}
        <div className="crud-modal-actions form-span">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setReviewAction(null)}>{tr("Cancel", "إلغاء")}</button>
          <button type="submit" className="primary-button" disabled={busy || reviewRetryBlocked || (reviewAction === "IMPORT" && reviewSnapshot.safe < 1) || (reviewAction === "RESOLVE" && reviewSnapshot.safe < 1 && !(reviewSnapshot.generatedTestsRemaining || 0))}>
            {busy ? tr("Submitting…", "جارٍ الإرسال…") : tr("Confirm reviewed import action", "تأكيد إجراء الاستيراد المراجع")}
          </button>
        </div>
      </form>}
    </CrudModal>

    {preview.review > 0 && Object.keys(preview.reasons || {}).length > 0 && <div className="range-review-reasons">
      <strong>{tr("Review reasons","أسباب المراجعة")}</strong>
      {Object.entries(preview.reasons).sort((a,b) => b[1]-a[1]).map(([reason,count]) => <div key={reason}><span>{reasonLabel(reason)}</span><strong>{count}</strong></div>)}
    </div>}

    <datalist id="test-mapping-options">{(preview.testOptions || []).map(test => <option key={test.id} value={`${test.code} — ${testName(test)}`} />)}</datalist>
    <datalist id="unit-mapping-options">{(preview.unitOptions || []).map(unit => <option key={unit.id} value={`${unit.symbol} (${unit.code})`} />)}</datalist>

    {preview.details && <div className="range-review-details">
      <section>
        <strong>{tr("Top unmatched test names","أكثر أسماء الفحوصات غير المطابقة")}</strong>
        {preview.details.unmatchedTests.length === 0 && <p className="muted">{tr("None","لا يوجد")}</p>}
        {preview.details.unmatchedTests.map(item => {
          const mapKey = `TEST_ALIAS:${item.value}`;
          return <div className="mapping-row" key={item.value}>
            <div className="mapping-source"><span>{item.value}</span><strong>{item.count}</strong></div>
            {item.suggestion && "nameEn" in item.suggestion && <button className="suggestion-button" type="button" onClick={() => { const s = item.suggestion as TestSuggestion; setMappingTargets(v => ({ ...v, [mapKey]: s.id })); setMappingSearch(v => ({ ...v, [mapKey]: `${s.code} — ${testName(s)}` })); }}>
              {tr("Suggested:","مقترح:")} {item.suggestion.code} — {testName(item.suggestion)} ({item.suggestion.score}%)
            </button>}
            {item.candidates && item.candidates.length > 0 && <div className="candidate-list">
              {item.candidates.filter((candidate): candidate is TestSuggestion => "nameEn" in candidate).map(candidate => <button key={candidate.id} type="button" className="candidate-chip" onClick={() => { setMappingTargets(v => ({ ...v, [mapKey]: candidate.id })); setMappingSearch(v => ({ ...v, [mapKey]: `${candidate.code} — ${testName(candidate)}` })); }}>
                {candidate.code} — {testName(candidate)} <span>{candidate.score}%</span>
              </button>)}
            </div>}
            <input
              className="mapping-search-input"
              list="test-mapping-options"
              placeholder={tr("Type test name or code…","اكتب اسم الفحص أو رمزه…")}
              value={mappingSearch[mapKey] || ""}
              onChange={e => {
                const value = e.target.value;
                setMappingSearch(v => ({ ...v, [mapKey]: value }));
                const match = (preview.testOptions || []).find(test => `${test.code} — ${testName(test)}` === value);
                setMappingTargets(v => ({ ...v, [mapKey]: match?.id || "" }));
              }}
            />
            <button className="secondary-button" disabled={busy || resolving || Boolean(mappingBusy) || reviewAction !== null} onClick={() => void saveMapping("TEST_ALIAS", item.value)}>{mappingBusy === mapKey ? tr("Saving…","جارٍ الحفظ…") : tr("Save","حفظ")}</button>
          </div>;
        })}
      </section>

      <section>
        <strong>{tr("Top unmapped units","أكثر الوحدات غير المربوطة")}</strong>
        {preview.details.unmappedUnits.length === 0 && <p className="muted">{tr("None","لا يوجد")}</p>}
        {preview.details.unmappedUnits.map(item => {
          const mapKey = `UNIT_ALIAS:${item.value}`;
          return <div className="mapping-row" key={item.value}>
            <div className="mapping-source"><span>{item.value}</span><strong>{item.count}</strong></div>
            {item.suggestion && "symbol" in item.suggestion && <button className="suggestion-button" type="button" onClick={() => { const s = item.suggestion as UnitSuggestion; setMappingTargets(v => ({ ...v, [mapKey]: s.id })); setMappingSearch(v => ({ ...v, [mapKey]: `${s.symbol} (${s.code})` })); }}>
              {tr("Suggested:","مقترح:")} {item.suggestion.symbol} ({item.suggestion.code}) — {item.suggestion.score}%
            </button>}
            {item.candidates && item.candidates.length > 0 && <div className="candidate-list">
              {item.candidates.filter((candidate): candidate is UnitSuggestion => "symbol" in candidate).map(candidate => <button key={candidate.id} type="button" className="candidate-chip" onClick={() => { setMappingTargets(v => ({ ...v, [mapKey]: candidate.id })); setMappingSearch(v => ({ ...v, [mapKey]: `${candidate.symbol} (${candidate.code})` })); }}>
                {candidate.symbol} ({candidate.code}) <span>{candidate.score}%</span>
              </button>)}
            </div>}
            <input
              className="mapping-search-input"
              list="unit-mapping-options"
              placeholder={tr("Type unit symbol or code…","اكتب رمز الوحدة أو كودها…")}
              value={mappingSearch[mapKey] || ""}
              onChange={e => {
                const value = e.target.value;
                setMappingSearch(v => ({ ...v, [mapKey]: value }));
                const match = (preview.unitOptions || []).find(unit => `${unit.symbol} (${unit.code})` === value);
                setMappingTargets(v => ({ ...v, [mapKey]: match?.id || "" }));
              }}
            />
            <button className="secondary-button" disabled={busy || resolving || Boolean(mappingBusy) || reviewAction !== null} onClick={() => void saveMapping("UNIT_ALIAS", item.value)}>{mappingBusy === mapKey ? tr("Saving…","جارٍ الحفظ…") : tr("Save","حفظ")}</button>
          </div>;
        })}
      </section>

      <section>
        <strong>{tr("Top unit conflicts","أكثر تعارضات الوحدات")}</strong>
        <p className="muted">{tr("These stay manual-review only because the legacy range unit conflicts with the mapped test unit.","تبقى هذه للمراجعة اليدوية فقط لأن وحدة المدى القديمة تتعارض مع وحدة الفحص المربوطة.")}</p>
        {preview.details.unitConflicts.map(item => <div key={item.value}><span>{item.value}</span><strong>{item.count}</strong></div>)}
      </section>
    </div>}
  </div>;
}
