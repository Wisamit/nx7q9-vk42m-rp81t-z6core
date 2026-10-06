"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

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
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) return;
    form.set("targetType", targetType);
    form.set("targetId", targetId);
    setBusy(true); setMessage("");
    const response = await fetch("/api/attachments", { method: "POST", body: form });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("Attachment uploaded securely.", "تم رفع المرفق بأمان."));
      event.currentTarget.reset();
      router.refresh();
    } else {
      setMessage(tr("Attachment upload failed.", "فشل رفع المرفق."));
    }
    setBusy(false);
  }

  return <div className="attachment-manager">
    <div className="attachment-list">
      {attachments.length === 0 ? <span className="muted">{tr("No attachments.","لا توجد مرفقات.")}</span> : attachments.map(item =>
        <a className="attachment-item" href={"/api/attachments/" + item.id} key={item.id}>
          <span>{item.originalName}</span>
          <small>{sizeLabel(item.sizeBytes)} · {item.uploadedBy} · {item.createdAt.replace("T"," ").slice(0,16)}</small>
        </a>
      )}
    </div>
    {canUpload && <form className="attachment-upload" onSubmit={upload}>
      <input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.txt,.docx,.xlsx" required />
      <button className="secondary-button" disabled={busy}>{busy ? tr("Uploading…","جارٍ الرفع…") : tr("Upload","رفع")}</button>
    </form>}
    {message && <p className="form-success">{message}</p>}
  </div>;
}
