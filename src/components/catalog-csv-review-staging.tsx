"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

const template = "entityType,legacyKey,testCode,code,nameEn,nameAr,unitCode,resultType,priceListCode,unitPrice,effectiveFrom,effectiveTo\\r\\n";
const rangeTemplate = "entityType,legacyKey,testName,unit,sex,ageFrom,ageTo,ageUnit,low,high,normalTextEn\\r\\n";

export function CatalogCsvReviewStaging({ locale, canStagePricing, canStageRanges }: { locale: "ar" | "en"; canStagePricing: boolean; canStageRanges: boolean }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;

  function saveTemplate(kind: "component-price" | "range") {
    const url = URL.createObjectURL(new Blob(["\uFEFF" + (kind === "range" ? rangeTemplate : template)], { type: "text/csv;charset=utf-8" }));
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = kind === "range" ? "family-lab-reference-range-review-template.csv" : "family-lab-csv-review-template.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function stage(file: File) {
    if (busy) return;
    if (!file.name.toLowerCase().endsWith(".csv") || file.size === 0 || file.size > 2 * 1024 * 1024) {
      setError(tr("Select a non-empty CSV file up to 2 MB.", "اختر ملف CSV غير فارغ بحجم لا يتجاوز 2 ميغابايت."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/imports/csv?sourceName=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "Content-Type": "text/csv;charset=utf-8" },
        body: file,
        cache: "no-store",
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error || "csv_stage_failed");
      router.push("/catalog/imports/" + encodeURIComponent(result.id));
      router.refresh();
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "csv_stage_failed";
      setError(tr("CSV staging failed: ", "فشل تجهيز ملف CSV: ") + code);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return <section className="detail-card detail-section">
    <h2>{tr("CSV clinical and price review staging", "تجهيز CSV لمراجعة الإعدادات السريرية والأسعار")}</h2>
    <p className="muted">{tr(
      "Upload canonical CSV rows for COMPONENT, PRICE_LIST_ITEM or REFERENCE_INTERVAL. They remain DRAFT for review only; no clinical configuration or prices are applied. This is not a roundtrip of CSV review exports.",
      "ارفع CSV بالأعمدة المحددة لمكونات التحاليل أو الأسعار أو المديات المرجعية. تبقى الدفعة مسودة للمراجعة فقط، دون تطبيق أي إعدادات طبية أو أسعار. ملفات CSV المصدرة للمراجعة ليست للاستعادة المباشرة.",
    )}</p>
    <p className="muted">{tr(
      "COMPONENT needs testCode, code, nameEn, unitCode and resultType. PRICE_LIST_ITEM needs priceListCode, testCode, unitPrice and effectiveFrom. Financial rows require pricing.manage.",
      "تحتاج المكونات إلى testCode وcode وnameEn وunitCode وresultType. تحتاج الأسعار إلى priceListCode وtestCode وunitPrice وeffectiveFrom. وتتطلب الأسعار صلاحية pricing.manage.",
    )}</p>
    {canStageRanges && <p className="muted">{tr(
      "REFERENCE_INTERVAL requires testName, unit, sex, ageFrom/ageTo with ageUnit when applicable, and low/high or normalTextEn. Only explicit DAY/WEEK/MONTH/YEAR and ANY/MALE/FEMALE values are accepted. Clinical approval is always required.",
      "تحتاج المديات المرجعية إلى testName وunit وsex وحدود العمر مع ageUnit عند وجودها، وlow/high أو normalTextEn. وحدات العمر DAY/WEEK/MONTH/YEAR والجنس ANY/MALE/FEMALE فقط. الاعتماد السريري إلزامي.",
    )}</p>}
    {!canStagePricing && <p className="muted">{tr(
      "Your current permissions allow component review staging only, not prices.",
      "تسمح صلاحياتك الحالية بتجهيز المكونات للمراجعة فقط، دون الأسعار.",
    )}</p>}
    <input ref={fileInput} type="file" hidden accept=".csv,text/csv"
      onChange={event => { const f = event.target.files?.[0]; if (f) void stage(f); }} />
    <div className="review-actions">
      <button type="button" className="secondary-button" disabled={busy}
        onClick={() => fileInput.current?.click()}>
        {busy ? tr("Validating…", "جارٍ التحقق…") : tr("Stage CSV for review", "تجهيز CSV للمراجعة")}
      </button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => saveTemplate("component-price")}>
        {tr("Download component / price template", "تنزيل قالب المكونات والأسعار")}
      </button>
      {canStageRanges && <button type="button" className="secondary-button" disabled={busy} onClick={() => saveTemplate("range")}>
        {tr("Download reference-range template", "تنزيل قالب المديات المرجعية")}
      </button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
