"use client";

import { useEffect, useState } from "react";
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

  async function resolveSafeLegacy() {
    if (!preview) return;
    setResolving(true);
    setMessage("");
    try {
      if ((preview.generatedTestsRemaining || 0) > 0) {
        const masters = await fetch(`/api/catalog/imports/${batchId}/commit`, { method: "POST" });
        const masterBody = await masters.json().catch(() => ({}));
        if (!masters.ok) throw new Error(tr("Safe master recovery failed.", "فشل استرجاع البيانات الأساسية الآمنة."));
      }

      const units = await fetch(`/api/catalog/imports/${batchId}/prepare-units`, { method: "POST" });
      const unitBody = await units.json().catch(() => ({}));
      if (!units.ok) throw new Error(tr("Legacy unit preparation failed.", "فشل تجهيز وحدات النظام القديم."));

      const ranges = await fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { method: "POST" });
      const rangeBody = await ranges.json().catch(() => ({}));
      if (!ranges.ok) throw new Error(tr("Reference range resolution failed.", "فشل حل المديات المرجعية."));

      setMessage(tr(`Resolved ${rangeBody.imported || 0} additional inactive reference intervals; ${rangeBody.review || 0} remain for manual review.`, `تم حل ${rangeBody.imported || 0} مدى مرجعي إضافي بحالة غير نشطة؛ بقي ${rangeBody.review || 0} للمراجعة اليدوية.`));
      await loadPreview();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : tr("Safe legacy resolution failed.", "فشل حل عناصر النظام القديم الآمنة."));
    } finally {
      setResolving(false);
    }
  }

  async function run() {
    if (!preview?.safe) return;
    if (!confirm(tr(`Import ${preview.safe} reference intervals with exact test/unit/context mapping as INACTIVE records pending clinical approval? ${preview.review} rows will remain for manual review.`, `هل تريد استيراد ${preview.safe} مدى مرجعي ذي مطابقة دقيقة للفحص/الوحدة/السياق كسجلات غير نشطة بانتظار الاعتماد السريري؟ سيبقى ${preview.review} صفاً للمراجعة اليدوية.`))) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr(`Imported ${body.imported} inactive reference intervals pending clinical approval; ${body.review} remain for mapping review.`, `تم استيراد ${body.imported} مدى مرجعي غير نشط بانتظار الاعتماد السريري؛ بقي ${body.review} لمراجعة الربط.`));
      await loadPreview();
      router.refresh();
    } else {
      setMessage(tr("Reference range import failed.", "فشل استيراد المديات المرجعية."));
    }
    setBusy(false);
  }

  async function saveMapping(mappingType: "TEST_ALIAS" | "UNIT_ALIAS", sourceValue: string) {
    const mapKey = `${mappingType}:${sourceValue}`;
    const targetId = mappingTargets[mapKey];
    if (!targetId) {
      setMessage(tr("Select a target before saving the mapping.", "اختر الهدف قبل حفظ الربط."));
      return;
    }

    setMappingBusy(mapKey);
    setMessage("");
    const response = await fetch(`/api/catalog/imports/${batchId}/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappingType, sourceValue, targetId }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr(`Saved reviewed mapping for "${sourceValue}". Re-analyzed remaining ranges.`, `تم حفظ الربط المراجع للقيمة "${sourceValue}" وإعادة تحليل المديات المتبقية.`));
      await loadPreview();
      router.refresh();
    } else {
      setMessage(tr("Could not save mapping.", "تعذر حفظ الربط."));
    }
    setMappingBusy("");
  }

  if (!preview) return <span className="muted">{tr("Analyzing reference ranges…", "جارٍ تحليل المديات المرجعية…")}</span>;

  return <div className="range-import-panel">
    <div className="range-import-summary">
      <strong>{tr("Reference ranges:","المديات المرجعية:")}</strong>
      <span>{preview.total} {tr("staged","مرحلي")}</span>
      <span>{preview.safe} {tr("safe","آمن")}</span>
      <span>{preview.review} {tr("review","للمراجعة")}</span>
    </div>

    {((preview.generatedTestsRemaining || 0) > 0 || preview.safe > 0) && <button className="primary-button" disabled={busy || resolving} onClick={resolveSafeLegacy}>{resolving ? tr("Resolving…","جارٍ الحل…") : tr("Resolve Safe Legacy Items","حل عناصر النظام القديم الآمنة")}</button>}
    {preview.safe > 0 && <button className="secondary-button" disabled={busy || resolving} onClick={run}>{busy ? tr("Importing ranges…","جارٍ استيراد المديات…") : tr("Import Safe Reference Ranges","استيراد المديات المرجعية الآمنة")}</button>}
    {message && <span className="range-import-message">{message}</span>}

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
            <button className="secondary-button" disabled={mappingBusy === mapKey} onClick={() => void saveMapping("TEST_ALIAS", item.value)}>{mappingBusy === mapKey ? tr("Saving…","جارٍ الحفظ…") : tr("Save","حفظ")}</button>
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
            <button className="secondary-button" disabled={mappingBusy === mapKey} onClick={() => void saveMapping("UNIT_ALIAS", item.value)}>{mappingBusy === mapKey ? tr("Saving…","جارٍ الحفظ…") : tr("Save","حفظ")}</button>
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
