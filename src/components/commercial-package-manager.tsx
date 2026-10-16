"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type TestOption = { id: string; code: string; nameEn: string; nameAr?: string | null };

export function CommercialPackageManager({ tests, locale }: { tests: TestOption[]; locale: "ar" | "en" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const testName = (test: TestOption) => locale === "ar" ? test.nameAr || test.nameEn : test.nameEn;

  const options = useMemo(() => tests.map(test => ({
    ...test,
    label: `${test.code} — ${locale === "ar" ? test.nameAr || test.nameEn : test.nameEn}`,
  })), [tests, locale]);
  const selected = selectedIds.map(id => tests.find(test => test.id === id)).filter((x): x is TestOption => Boolean(x));

  function addTest() {
    const match = options.find(option => option.label === search);
    if (!match) {
      setMessage(tr("Select a valid test from the suggestions.", "اختر فحصًا صحيحًا من الاقتراحات."));
      return;
    }
    setSelectedIds(ids => ids.includes(match.id) ? ids : [...ids, match.id]);
    setSearch("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (selectedIds.length === 0) {
      setMessage(tr("Add at least one test to the package.", "أضف فحصًا واحدًا على الأقل إلى الباقة."));
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/catalog/packages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.get("code"),
          nameEn: form.get("nameEn"),
          nameAr: form.get("nameAr"),
          descriptionEn: form.get("descriptionEn"),
          descriptionAr: form.get("descriptionAr"),
          testIds: selectedIds,
        }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string; package?: { code?: string } };
      if (!response.ok) {
        setMessage(body.error || tr("Could not create package.", "تعذر إنشاء الباقة."));
        return;
      }
      setOpen(false);
      setMessage(tr(
        "Package created: " + (body.package?.code || ""),
        "تم إنشاء الباقة: " + (body.package?.code || ""),
      ));
      setSelectedIds([]);
      setSearch("");
      router.refresh();
    } catch {
      setMessage(tr("Connection interrupted. Check if the package was saved before retrying.",
        "انقطع الاتصال؛ تحقق إن كانت الباقة قد حُفظت قبل إعادة المحاولة."));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => { setMessage(""); setOpen(true); }}>{tr("Commercial Package", "باقة تجارية")}</button>
    <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }}
      size="compact"
      title={tr("Create Commercial Package", "إنشاء باقة تجارية")}
      description={tr(
        "Commercial groupings do not merge member tests clinically; specimen, component result, pricing and audit traceability remain per test.",
        "التجميع التجاري لا يدمج الفحوصات سريرياً؛ يظل تتبع العينات والنتائج والتسعير والتدقيق لكل فحص مستقلاً.",
      )}>
      {open &&         <form className="catalog-form" onSubmit={submit}>
          <label>{tr("Code", "الرمز")}<input name="code" required maxLength={80} /></label>
          <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required maxLength={220} /></label>
          <label>{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" dir="rtl" maxLength={220} /></label>
          <label className="form-span">{tr("Description (English)", "الوصف بالإنجليزية")}<textarea name="descriptionEn" rows={2} /></label>
          <label className="form-span">{tr("Description (Arabic)", "الوصف بالعربية")}<textarea name="descriptionAr" rows={2} dir="rtl" /></label>
          <div className="form-span order-test-picker">
            <label>{tr("Member tests", "الفحوصات المشمولة")}
              <div className="inline-search">
                <input list="commercial-package-test-options" value={search} onChange={event => setSearch(event.target.value)} placeholder={tr("Type test code or name…", "اكتب رمز الفحص أو اسمه…")} />
                <button type="button" className="secondary-button" onClick={addTest}>{tr("Add Test", "إضافة فحص")}</button>
              </div>
              <datalist id="commercial-package-test-options">{options.map(option => <option key={option.id} value={option.label} />)}</datalist>
            </label>
            <div className="selected-test-list">
              {selected.length === 0 ? <span className="muted">{tr("No tests selected.", "لم يتم اختيار فحوصات.")}</span> : selected.map(test =>
                <span className="selected-test-chip" key={test.id}>{test.code} — {testName(test)}<button type="button" onClick={() => setSelectedIds(ids => ids.filter(id => id !== test.id))}>×</button></span>
              )}
            </div>
          </div>
          {message && <p role="alert" className="form-error form-span">{message}</p>}
          <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Commercial Package", "إنشاء الباقة التجارية")}</button>
        </form>}
    </CrudModal>
    {!open && message && <p className="form-success" role="status">{message}</p>}
  </>;
}
