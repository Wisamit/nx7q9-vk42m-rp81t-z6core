"use client";

import { useState } from "react";
import { ReviewFileUploadDialog } from "@/components/review-file-upload-dialog";
import { useRouter } from "next/navigation";
import { catalogReviewXlsx } from "@/lib/catalog-review-xlsx";

const template = "entityType,legacyKey,testCode,code,nameEn,nameAr,unitCode,resultType,priceListCode,unitPrice,effectiveFrom,effectiveTo\r\n";
const rangeTemplate = "entityType,legacyKey,testName,unit,sex,ageFrom,ageTo,ageUnit,low,high,normalTextEn\r\n";
const masterTemplate = "entityType,legacyKey,code,nameEn,nameAr,symbol,memberTestCodes\r\n";
const packagePriceTemplate = "entityType,legacyKey,priceListCode,packageCode,unitPrice,effectiveFrom,effectiveTo\r\n";
const priceListTemplate = "entityType,legacyKey,code,nameEn,nameAr,scopeType,branchId,currency,priority,effectiveFrom,effectiveTo\r\n";

export function CatalogCsvReviewStaging({ locale, canStagePricing, canStageRanges }: { locale: "ar" | "en"; canStagePricing: boolean; canStageRanges: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;

  function saveTemplate(kind: "component-price" | "range" | "master" | "package-price" | "price-list", format: "csv" | "xlsx" = "csv") {
    const text = "\uFEFF" + (kind === "range" ? rangeTemplate : kind === "master"
      ? masterTemplate : kind === "package-price" ? packagePriceTemplate : kind === "price-list" ? priceListTemplate : template);
    const data = format === "xlsx" ? catalogReviewXlsx(text) : text;
    const part: BlobPart = typeof data === "string" ? data :
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([part], { type: format === "xlsx"
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv;charset=utf-8" }));
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = "family-lab-" + (kind === "range" ? "reference-range" :
        kind === "master" ? "masters-membership" : kind === "package-price" ? "package-price" : kind === "price-list" ? "price-list" : "component-price")
        + "-review-template." + format;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function stage(file: File): Promise<boolean> {
    if (busy) return false;
    const isXlsx = file.name.toLowerCase().endsWith(".xlsx");
    if (!isXlsx && !file.name.toLowerCase().endsWith(".csv") || file.size === 0 || file.size > 2 * 1024 * 1024) {
      setError(tr("Select a non-empty CSV or XLSX up to 2 MB.", "اختر CSV أو XLSX غير فارغ بحجم لا يتجاوز 2 ميغابايت."));
      return false;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/catalog/imports/csv?sourceName=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "Content-Type": isXlsx
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv;charset=utf-8" },
        body: file,
        cache: "no-store",
      });
      const result = await response.json() as { id?: string; error?: string };
      if (!response.ok || !result.id) throw new Error(result.error || "csv_stage_failed");
      router.push("/catalog/imports/" + encodeURIComponent(result.id));
      router.refresh();
      return true;
    } catch (caught) {
      const code = caught instanceof Error ? caught.message : "csv_stage_failed";
      setError(tr("CSV/XLSX staging failed: ", "فشل تجهيز ملف CSV/XLSX: ") + code);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return <section className="detail-card detail-section">
    <h2>{tr("CSV/Excel clinical and price review staging", "تجهيز CSV/Excel لمراجعة الإعدادات السريرية والأسعار")}</h2>
    <p className="muted">{tr(
      "Upload canonical CSV / one-sheet XLSX templates for tests, units, containers, panels, packages, components, ranges and prices. All remain review-only DRAFT; original export workbooks are not direct imports.",
      "ارفع CSV أو XLSX بورقة واحدة لتجهيز الفحوصات والوحدات والمجموعات والباقات والمكونات والمديات والأسعار للمراجعة. تبقى جميعها مسودة فقط دون تفعيل مباشر.",
    )}</p>
    <p className="muted">{tr(
      "COMPONENT needs testCode, code, nameEn, unitCode and resultType. PRICE_LIST_ITEM needs priceListCode, testCode, unitPrice and effectiveFrom. Financial rows require pricing.manage.",
      "تحتاج المكونات إلى testCode وcode وnameEn وunitCode وresultType. تحتاج الأسعار إلى priceListCode وtestCode وunitPrice وeffectiveFrom. وتتطلب الأسعار صلاحية pricing.manage.",
    )}</p>
    {canStageRanges && <p className="muted">{tr(
      "REFERENCE_INTERVAL requires testName, unit, sex, ageFrom/ageTo with ageUnit when applicable, and low/high or normalTextEn. Only explicit DAY/WEEK/MONTH/YEAR and ANY/MALE/FEMALE values are accepted. Clinical approval is always required.",
      "تحتاج المديات المرجعية إلى testName وunit وsex وحدود العمر مع ageUnit عند وجودها، وlow/high أو normalTextEn. وحدات العمر DAY/WEEK/MONTH/YEAR والجنس ANY/MALE/FEMALE فقط. الاعتماد السريري إلزامي.",
    )}</p>}
    <p className="muted">{tr(
      'For panels/packages supply memberTestCodes as a JSON array of existing test codes, e.g. ["CBC","TSH"]. Missing membership is an error; no members are guessed.',
      'للمجموعات والباقات يجب إدخال memberTestCodes كمصفوفة JSON لرموز فحوصات موجودة مثل ["CBC","TSH"]. عدم تحديد العضوية خطأ؛ لا تُستنتج تلقائياً.',
    )}</p>
    {!canStagePricing && <p className="muted">{tr(
      "Pricing templates require the pricing.manage permission; other review-only templates remain available.",
      "قوالب الأسعار تتطلب صلاحية pricing.manage، والقوالب الأخرى للمراجعة فقط.",
    )}</p>}
    <div className="review-actions">
      <ReviewFileUploadDialog locale={locale} busy={busy} error={error}
        onResetError={() => setError("")}
        title={tr("Review clinical and price spreadsheet", "مراجعة جدول الإعدادات السريرية والأسعار")}
        description={tr("Select a canonical CSV or single-sheet XLSX and confirm controlled draft staging.", "اختر ملف CSV أو XLSX بورقة واحدة ثم أكد تجهيز المسودة للمراجعة.")}
        triggerLabel={tr("Stage CSV / XLSX for review", "تجهيز CSV / XLSX للمراجعة")}
        accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        fileHint={tr("CSV or XLSX, maximum 2 MB. Reference intervals and prices still need their own approvals.", "ملف CSV أو XLSX بحد أقصى 2 ميغابايت؛ تظل الأسعار والمديات المرجعية بحاجة لاعتماد مستقل.")}
        onStage={stage} />
      <button type="button" className="secondary-button" disabled={busy}
        onClick={() => saveTemplate("master", "xlsx")}>
        {tr("Download Excel tests / units / panels / packages template", "تنزيل قالب Excel للفحوصات والوحدات والمجموعات والباقات")}
      </button>
      <button type="button" className="secondary-button" disabled={busy}
        onClick={() => saveTemplate("master")}>
        {tr("Download CSV master catalog template", "تنزيل قالب CSV لدليل الفحوصات")}
      </button>
      {canStagePricing && <button type="button" className="secondary-button" disabled={busy}
        onClick={() => saveTemplate("price-list", "xlsx")}>
        {tr("Excel price-list master review template", "قالب Excel لمراجعة قوائم الأسعار")}
      </button>}
      {canStagePricing && <button type="button" className="secondary-button" disabled={busy}
        onClick={() => saveTemplate("price-list")}>
        {tr("CSV price-list master review template", "قالب CSV لمراجعة قوائم الأسعار")}
      </button>}
      {canStagePricing && <button type="button" className="secondary-button" disabled={busy}
        onClick={() => saveTemplate("package-price", "xlsx")}>
        {tr("Download Excel package-price template", "تنزيل قالب Excel لأسعار الباقات")}
      </button>}
      {canStagePricing && <button type="button" className="secondary-button" disabled={busy}
        onClick={() => saveTemplate("package-price")}>
        {tr("Download CSV package-price template", "تنزيل قالب CSV لأسعار الباقات")}
      </button>}
      <button type="button" className="secondary-button" disabled={busy} onClick={() => saveTemplate("component-price")}>
        {tr("Download component / price template", "تنزيل قالب المكونات والأسعار")}
      </button>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => saveTemplate("component-price", "xlsx")}>
        {tr("Download Excel component / price template", "تنزيل قالب Excel للمكونات والأسعار")}
      </button>
      {canStageRanges && <button type="button" className="secondary-button" disabled={busy} onClick={() => saveTemplate("range", "xlsx")}>
        {tr("Download Excel reference-range template", "تنزيل قالب Excel للمديات المرجعية")}
      </button>}
      {canStageRanges && <button type="button" className="secondary-button" disabled={busy} onClick={() => saveTemplate("range")}>
        {tr("Download reference-range template", "تنزيل قالب المديات المرجعية")}
      </button>}
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
