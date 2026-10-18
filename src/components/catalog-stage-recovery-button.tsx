"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { validateCatalogStageRecovery, type RecoverableStageSource } from "@/lib/catalog-stage-recovery";

/**
 * A lost POST response is reconciled by a read-only, author-scoped GET.
 * NOT FOUND never licenses a second POST: the original may still be in flight.
 */
export function CatalogStageRecoveryButton({
  sourceType, submissionKey, locale,
}: {
  sourceType: RecoverableStageSource;
  submissionKey: string | null;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const ar = locale === "ar";

  async function check() {
    if (!submissionKey || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const query = new URLSearchParams({ sourceType, key: submissionKey });
      const response = await fetch("/api/catalog/imports/recovery?" + query, {
        method: "GET", credentials: "same-origin", cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      const id = response.ok ? validateCatalogStageRecovery(body) : null;
      if (id) {
        router.push("/catalog/imports/" + encodeURIComponent(id));
        router.refresh();
        return;
      }
      setMessage(response.status === 403
        ? (ar ? "تغيّرت صلاحياتك. اطلب مراجعة الصلاحيات قبل فتح المسودة."
          : "Your permissions changed. Request access review before opening the draft.")
        : (ar ? "لم يتأكد وجود الدفعة بعد. قد يكون الطلب الأصلي قيد التنفيذ؛ راجع سجل الدفعات ولا تعِد رفع الملف."
          : "Batch not confirmed yet. The original request may still be running; check your batch list and do not re-upload."));
    } catch {
      setMessage(ar
        ? "تعذّر التحقق من الطلب السابق. لا ترفع الملف مجدداً قبل مراجعة سجل الدفعات."
        : "Could not check the previous request. Do not re-upload before reviewing the batch list.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!submissionKey) return null;
  return <div className="form-stack">
    <button type="button" className="secondary-button" disabled={busy}
      onClick={() => void check()}>
      {busy ? (ar ? "جارٍ التحقق من الطلب السابق…" : "Checking previous request…")
        : (ar ? "تحقق من الدفعة السابقة دون إعادة رفع" : "Find previous batch without re-uploading")}
    </button>
    {message && <p role="alert" className="form-warning">{message}</p>}
  </div>;
}
