"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type AttachmentItem = {
  id: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string;
};

function sizeLabel(value: number) {
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  return (value / 1024 / 1024).toFixed(1) + " MB";
}

export function AttachmentManager({
  targetType,
  targetId,
  attachments,
  canUpload,
  locale = "en",
}: {
  targetType: string;
  targetId: string;
  attachments: AttachmentItem[];
  canUpload: boolean;
  locale?: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canUpload || busy) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) {
      setFormError(tr("Choose a non-empty file.", "اختر ملفاً غير فارغ."));
      return;
    }
    form.set("targetType", targetType);
    form.set("targetId", targetId);
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch("/api/attachments", { method: "POST", body: form });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setFormError(body.error
          ? tr("Attachment upload failed: ", "فشل رفع المرفق: ") + body.error
          : tr("Attachment upload failed.", "فشل رفع المرفق."));
        return;
      }
      element.reset();
      setUploadOpen(false);
      setMessage(tr("Attachment uploaded securely.", "تم رفع المرفق بأمان."));
      router.refresh();
    } catch {
      setFormError(tr("Connection error. Upload was not confirmed.", "حدث خطأ في الاتصال؛ لم يتم تأكيد رفع المرفق."));
    } finally {
      setBusy(false);
    }
  }

  return <div className="attachment-manager">
    <div className="attachment-list">
      {attachments.length === 0 ? <span className="muted">{tr("No attachments.","لا توجد مرفقات.")}</span> : attachments.map(item =>
        <a className="attachment-item" href={"/api/attachments/" + item.id} key={item.id}>
          <span>{item.originalName}</span>
          <small>{sizeLabel(item.sizeBytes)} · {item.uploadedBy} · {item.createdAt.replace("T"," ").slice(0,16)} UTC</small>
        </a>
      )}
    </div>
    {canUpload && <button type="button" className="secondary-button" disabled={busy}
      onClick={() => { setFormError(""); setMessage(""); setUploadOpen(true); }}>
      {tr("Upload attachment", "رفع مرفق")}
    </button>}
    {message && <p className="form-success" role="status">{message}</p>}
    <CrudModal open={canUpload && uploadOpen}
      onClose={() => { if (!busy) setUploadOpen(false); }}
      size="compact"
      title={tr("Upload Attachment", "رفع مرفق")}
      description={tr(
        "Attach one document to this authorized record. The existing server validates type, size, target scope and access.",
        "أرفق مستنداً واحداً بالسجل المخوّل؛ يتحقق السيرفر من النوع والحجم ونطاق السجل والصلاحيات.",
      )}>
      {canUpload && uploadOpen && <form className="catalog-form" onSubmit={upload}>
        <label className="form-span">{tr("File", "الملف")}
          <input name="file" type="file"
            accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx" required />
        </label>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button type="submit" className="primary-button form-span" disabled={busy}>
          {busy ? tr("Uploading…", "جارٍ الرفع…") : tr("Upload securely", "رفع آمن")}
        </button>
      </form>}
    </CrudModal>
  </div>;
}
