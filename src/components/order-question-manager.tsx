"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function OrderQuestionManager({ testId }: { testId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const options = String(form.get("options") || "")
      .split("\n")
      .map(value => value.trim())
      .filter(Boolean);

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
        options,
      }),
    });

    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.ok) {
      setMessage("Order question created.");
      event.currentTarget.reset();
      router.refresh();
    } else {
      setMessage(body.error || "Could not create order question.");
    }
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label>Code<input name="code" required placeholder="LMP / LAST_DOSE_TIME" /></label>
    <label>Response type
      <select name="responseType" defaultValue="TEXT">
        <option value="TEXT">Text</option>
        <option value="NUMERIC">Numeric</option>
        <option value="BOOLEAN">Yes / No</option>
        <option value="DATE">Date</option>
        <option value="SINGLE_CHOICE">Single choice</option>
      </select>
    </label>
    <label>Question (English)<input name="questionEn" required /></label>
    <label dir="rtl">السؤال بالعربية<input name="questionAr" dir="rtl" /></label>
    <label>Display order<input name="displayOrder" type="number" min="0" defaultValue="0" /></label>
    <label className="check-line"><input name="required" type="checkbox" /> Required at order entry</label>
    <label className="form-span">Choice options <small>For SINGLE_CHOICE only; one option per line.</small>
      <textarea name="options" rows={4} placeholder={"Fasting\nNon-fasting"} />
    </label>
    {message && <div className="form-success form-span">{message}</div>}
    <button className="primary-button form-span" disabled={busy}>{busy ? "Saving…" : "Add Order Question"}</button>
  </form>;
}
