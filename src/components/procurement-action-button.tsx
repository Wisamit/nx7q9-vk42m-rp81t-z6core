"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

export function ProcurementActionButton({
  endpoint,
  label,
  confirmText,
  locale,
}: {
  endpoint: string;
  label: string;
  confirmText: string;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !open) return;
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setFormError(body.error || tr("Action failed.", "فشلت العملية."));
        return;
      }
      setOpen(false);
      setMessage(tr("Updated.", "تم التحديث."));
      router.refresh();
    } catch {
      setFormError(tr(
        "Connection interrupted; verify purchase order state before retrying.",
        "انقطع الاتصال؛ تحقق من حالة أمر الشراء قبل إعادة المحاولة.",
      ));
    } finally {
      setBusy(false);
    }
  }

  return <span>
    <button type="button" className="secondary-button" disabled={busy}
      onClick={() => { setMessage(""); setFormError(""); setOpen(true); }}>
      {busy ? tr("Working…", "جارٍ التنفيذ…") : label}
    </button>
    {message && <small role="status" className="form-success">{message}</small>}
    <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }}
      size="compact"
      title={label}
      description={tr(
        "This action changes a governed procurement workflow. Existing purchase, supplier, inventory and financial history remain subject to server authorization.",
        "يغيّر هذا الإجراء مسار مشتريات محكوماً؛ تبقى سجلات المشتريات والموردين والمخزون والتاريخ المالي خاضعة لصلاحيات السيرفر.",
      )}>
      {open && <form className="catalog-form" onSubmit={run}>
        <p className="form-span">{confirmText}</p>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button type="submit" className="primary-button form-span" disabled={busy}>
          {busy ? tr("Processing…", "جارٍ التنفيذ…") :
            tr("Confirm procurement action", "تأكيد إجراء المشتريات")}
        </button>
      </form>}
    </CrudModal>
  </span>;
}
