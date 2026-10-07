"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function CommentTemplateStatusButton({
  id,
  status,
  locale,
}: {
  id: string;
  status: "ACTIVE" | "INACTIVE";
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const nextStatus = status === "ACTIVE" ? "INACTIVE" : "ACTIVE";

  async function changeStatus() {
    const prompt = nextStatus === "INACTIVE"
      ? tr("Deactivate this comment template? Existing historical results are not changed.", "تعطيل قالب التعليق؟ لن تتغير النتائج التاريخية الحالية.")
      : tr("Reactivate this comment template?", "إعادة تفعيل قالب التعليق؟");
    if (!confirm(prompt)) return;

    setBusy(true);
    const response = await fetch("/api/clinical-rules/comments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: nextStatus }),
    });
    setBusy(false);
    if (response.ok) router.refresh();
    else alert(tr("Could not update comment template status.", "تعذر تحديث حالة قالب التعليق."));
  }

  return <button type="button" className="secondary-button" disabled={busy} onClick={() => void changeStatus()}>
    {busy
      ? tr("Saving…", "جارٍ الحفظ…")
      : nextStatus === "INACTIVE"
        ? tr("Deactivate", "تعطيل")
        : tr("Reactivate", "إعادة تفعيل")}
  </button>;
}
