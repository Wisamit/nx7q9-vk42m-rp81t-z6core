"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function OrderQuestionManager({ testId, locale }: { testId: string; locale: "ar" | "en" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
    setBusy(false);
    if (response.ok) {
      setMessage(tr("Order question created.", "تم إنشاء سؤال الطلب."));
      event.currentTarget.reset();
      router.refresh();
    } else {
      setMessage(tr("Could not create order question.", "تعذر إنشاء سؤال الطلب."));
    }
  }

  return <form className="catalog-form" onSubmit={submit}>
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
    <label>{tr("Effective from","ساري من")}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
    <label>{tr("Effective to","ساري حتى")}<input name="effectiveTo" type="date" /></label>
    <label className="check-line"><input name="required" type="checkbox" /> {tr("Required at order entry","مطلوب عند إدخال الطلب")}</label>
    <label className="form-span">{tr("Choice options","خيارات الاختيار")} <small>{tr("For SINGLE_CHOICE: CODE | English | Arabic, one option per line.","لنوع SINGLE_CHOICE: الرمز | English | العربية، خيار واحد في كل سطر.")}</small>
      <textarea name="options" rows={4} placeholder={"FASTING | Fasting | صائم\nNON_FASTING | Non-fasting | غير صائم"} />
    </label>
    <p className="muted form-span">{tr("Reusing the same question code creates a new effective-dated version and preserves all prior order answers.", "إعادة استخدام رمز السؤال نفسه تنشئ إصدارًا جديدًا مؤرخًا بالسريان مع الحفاظ على جميع إجابات الطلبات السابقة.")}</p>
    {message && <div className="form-success form-span">{message}</div>}
    <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…","جارٍ الحفظ…") : tr("Add Order Question","إضافة سؤال الطلب")}</button>
  </form>;
}
