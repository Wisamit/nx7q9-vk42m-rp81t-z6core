"use client";
import { SystemDateField } from "@/components/system-date-field";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

export function OrderQuestionManager({ testId, locale }: { testId: string; locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setMessage("");

    const options = String(form.get("options") || "")
      .split("\n")
      .map(value => value.trim())
      .filter(Boolean)
      .map((value) => {
        const parts = value.split("|").map(part => part.trim());
        return parts.length >= 2
          ? { code: parts[0], valueEn: parts[1], valueAr: parts.slice(2).join(" | ") || null }
          : { code: value, valueEn: value, valueAr: null };
      });

    try {
    const response = await fetch(`/api/catalog/tests/${testId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        questionEn: form.get("questionEn"),
        questionAr: form.get("questionAr"),
        responseType: form.get("responseType"),
        required: form.get("required") === "on",
        displayOrder: Number(form.get("displayOrder") || 0),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
        options,
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("Order question created.", "تم إنشاء سؤال الطلب."));
      formElement.reset();
      setOpen(false);
      router.refresh();
    } else {
      setMessage(body.error
        ? tr("Could not create order question: ", "تعذر إنشاء سؤال الطلب: ") + body.error
        : tr("Could not create order question.", "تعذر إنشاء سؤال الطلب."));
    }
    } catch {
      setMessage(tr("Connection error. The question draft was not confirmed as saved.",
        "خطأ في الاتصال؛ لم يتم تأكيد حفظ مسودة السؤال."));
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button type="button" className="primary-button" disabled={busy}
      onClick={() => { setMessage(""); setOpen(true); }}>
      {tr("Add Order Question", "إضافة سؤال للطلب")}
    </button>
    <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }}
      size="compact"
      title={tr("Create Effective-dated Order Question", "إنشاء سؤال طلب مؤرخ بالسريان")}
      description={tr(
        "Order answers and question versions are preserved. Enter the approved effective date in your intended local calendar.",
        "تُحفظ إجابات الطلب وإصدارات السؤال؛ أدخل تاريخ السريان المعتمد وفق التقويم المحلي المقصود.",
      )}>
      {open && <form className="catalog-form" onSubmit={submit}>
    <label>{tr("Code","الرمز")}<input name="code" required placeholder="LMP / LAST_DOSE_TIME" /></label>
    <label>{tr("Response type","نوع الإجابة")}
      <select name="responseType" defaultValue="TEXT">
        <option value="TEXT">{tr("Text","نص")}</option>
        <option value="NUMERIC">{tr("Numeric","رقمي")}</option>
        <option value="BOOLEAN">{tr("Yes / No","نعم / لا")}</option>
        <option value="DATE">{tr("Date","تاريخ")}</option>
        <option value="DATETIME">{tr("Date & time","التاريخ والوقت")}</option>
        <option value="SINGLE_CHOICE">{tr("Single choice","اختيار واحد")}</option>
      </select>
    </label>
    <label>{tr("Question (English)","السؤال بالإنجليزية")}<input name="questionEn" required /></label>
    <label>{tr("Question (Arabic)","السؤال بالعربية")}<input name="questionAr" dir="rtl" /></label>
    <label>{tr("Display order","ترتيب العرض")}<input name="displayOrder" type="number" min="0" defaultValue="0" /></label>
    <label>{tr("Effective from","ساري من")}<SystemDateField name="effectiveFrom" required /></label>
    <label>{tr("Effective to","ساري حتى")}<SystemDateField name="effectiveTo" /></label>
    <label className="check-line"><input name="required" type="checkbox" /> {tr("Required at order entry","مطلوب عند إدخال الطلب")}</label>
    <label className="form-span">{tr("Choice options","خيارات الاختيار")} <small>{tr("For SINGLE_CHOICE: CODE | English | Arabic, one option per line.","لنوع SINGLE_CHOICE: الرمز | English | العربية، خيار واحد في كل سطر.")}</small>
      <textarea name="options" rows={4} placeholder={"FASTING | Fasting | صائم\nNON_FASTING | Non-fasting | غير صائم"} />
    </label>
    <p className="muted form-span">{tr("Reusing the same question code creates a new effective-dated version and preserves all prior order answers.", "إعادة استخدام رمز السؤال نفسه تنشئ إصدارًا جديدًا مؤرخًا بالسريان مع الحفاظ على جميع إجابات الطلبات السابقة.")}</p>
    {message && <p className="form-error form-span" role="alert">{message}</p>}
    <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…","جارٍ الحفظ…") : tr("Add Order Question","إضافة سؤال الطلب")}</button>
    </form>}
    </CrudModal>
    {!open && message && <p className="form-success" role="status">{message}</p>}
  </>;
}
