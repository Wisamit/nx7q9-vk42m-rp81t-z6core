"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useUiLocale } from "@/components/ui-locale-provider";

type TestOption = { id: string; code: string; nameEn: string };

export function CommercialPackageManager({ tests }: { tests: TestOption[] }) {
  const router = useRouter();
  const { t } = useUiLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => tests.map(test => ({
    ...test,
    label: `${test.code} — ${test.nameEn}`,
  })), [tests]);
  const selected = selectedIds.map(id => tests.find(test => test.id === id)).filter((x): x is TestOption => Boolean(x));

  function addTest() {
    const match = options.find(option => option.label === search);
    if (!match) {
      setMessage(t("Select a valid test from the suggestions.", "اختر فحصًا صحيحًا من الاقتراحات."));
      return;
    }
    setSelectedIds(ids => ids.includes(match.id) ? ids : [...ids, match.id]);
    setSearch("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedIds.length === 0) {
      setMessage(t("Add at least one test to the package.", "أضف فحصًا واحدًا على الأقل إلى الباقة."));
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
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
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`${t("Package created", "تم إنشاء الباقة")}: ${body.package.code}`);
      setSelectedIds([]);
      setSearch("");
      event.currentTarget.reset();
      router.refresh();
    } else {
      setMessage(body.error || t("Could not create package.", "تعذر إنشاء الباقة."));
    }
    setBusy(false);
  }

  return <>
    <button className="secondary-button" type="button" onClick={() => setOpen(true)}>{t("Commercial Package", "باقة تجارية")}</button>
    {open && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setOpen(false)}>
      <div className="modal-card">
        <div className="modal-head">
          <div><p className="eyebrow">{t("Commercial Catalog", "الدليل التجاري")}</p><h2>{t("Create Package", "إنشاء باقة")}</h2></div>
          <button className="icon-button" type="button" onClick={() => setOpen(false)}>×</button>
        </div>
        <p className="muted">{t("Packages are commercial groupings. Member tests remain separate clinical order items for specimen, result and audit traceability.", "الباقات هي تجميعات تجارية، بينما تبقى الفحوصات الأعضاء عناصر سريرية منفصلة لضمان تتبع العينة والنتيجة والتدقيق.")}</p>
        <form className="catalog-form" onSubmit={submit}>
          <label>{t("Code", "الرمز")}<input name="code" required maxLength={80} /></label>
          <label>{t("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required maxLength={220} /></label>
          <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" maxLength={220} /></label>
          <label className="form-span">{t("Description", "الوصف بالإنجليزية")}<textarea name="descriptionEn" rows={2} /></label>
          <label className="form-span" dir="rtl">الوصف<textarea name="descriptionAr" rows={2} dir="rtl" /></label>
          <div className="form-span order-test-picker">
            <label>{t("Member tests", "فحوصات الباقة")}
              <div className="inline-search">
                <input list="commercial-package-test-options" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("Type test code or name…", "اكتب رمز الفحص أو اسمه…")} />
                <button type="button" className="secondary-button" onClick={addTest}>{t("Add Test", "إضافة فحص")}</button>
              </div>
              <datalist id="commercial-package-test-options">{options.map(option => <option key={option.id} value={option.label} />)}</datalist>
            </label>
            <div className="selected-test-list">
              {selected.length === 0 ? <span className="muted">{t("No tests selected.", "لم يتم اختيار فحوصات.")}</span> : selected.map(test =>
                <span className="selected-test-chip" key={test.id}>{test.code} — {test.nameEn}<button type="button" onClick={() => setSelectedIds(ids => ids.filter(id => id !== test.id))}>×</button></span>
              )}
            </div>
          </div>
          {message && <div className="form-success form-span">{message}</div>}
          <button className="primary-button form-span" disabled={busy}>{busy ? t("Saving…", "جارٍ الحفظ…") : t("Create Commercial Package", "إنشاء الباقة التجارية")}</button>
        </form>
      </div>
    </div>}
  </>;
}
