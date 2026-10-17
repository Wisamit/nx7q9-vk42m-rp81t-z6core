"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemDateText } from "@/components/system-date-text";

type Source = {
  id: string;
  code: string;
  revisionNumber: number;
  createdAt: string;
  scope: "ORGANIZATION" | "TEST" | "COMPONENT";
  target: string;
  nameEn: string;
  nameAr: string | null;
  textEn: string;
  textAr: string | null;
  fingerprint: string;
};

export function CommentRevisionEditor({
  sources, locale,
}: { sources: Source[]; locale: "en" | "ar" }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [id, setId] = useState(sources[0]?.id ?? "");
  const current = sources.find(s => s.id === id);
  const [nameEn, setNameEn] = useState(current?.nameEn ?? "");
  const [nameAr, setNameAr] = useState(current?.nameAr ?? "");
  const [textEn, setTextEn] = useState(current?.textEn ?? "");
  const [textAr, setTextAr] = useState(current?.textAr ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);

  function choose(value: string) {
    const item = sources.find(x => x.id === value);
    setId(value);
    setNameEn(item?.nameEn ?? "");
    setNameAr(item?.nameAr ?? "");
    setTextEn(item?.textEn ?? "");
    setTextAr(item?.textAr ?? "");
    setReason("");
    setMessage("");
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!current || busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/clinical-rules/comments/revisions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: current.id, expectedFingerprint: current.fingerprint,
          nameEn, nameAr, textEn, textAr, reason,
        }),
      });
      const result = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setMessage(tr("Revision not saved: ", "تعذر حفظ النسخة: ") + (result.error ?? "unknown_error"));
      } else {
        setOpen(false);
        setMessage(tr(
          "Inactive revision saved. An independent clinical reviewer can examine it in the Comment Approval Queue.",
          "تم حفظ النسخة الجديدة غير مفعلة، ويمكن للمراجع السريري المستقل اعتمادها من قائمة مراجعة التعليقات.",
        ));
        router.refresh();
      }
    } catch {
      setMessage(tr("Connection failed. Check current status before retrying.",
        "فشل الاتصال. تحقق من الحالة قبل إعادة المحاولة."));
    } finally { setBusy(false); }
  }

  if (sources.length === 0) return <p className="muted">{tr(
    "No active templates without a successor in this page. Go to the next page if available.",
    "لا توجد قوالب معتمدة بدون نسخة لاحقة في هذه الصفحة. انتقل إلى الصفحة التالية إن وجدت.",
  )}</p>;
  return <>
    <button type="button" className="primary-button" disabled={busy}
      onClick={() => { setMessage(""); setOpen(true); }}>
      {tr("Create New Comment Revision", "إنشاء إصدار جديد لتعليق سريري")}
    </button>
    {!open && message && <p className="form-success" role="status">{message}</p>}
    <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }}
      size="compact"
      title={tr("Create Result Comment Revision Draft", "إنشاء مسودة إصدار تعليق على النتائج")}
      description={tr(
        "The approved source is never overwritten. A separate clinical reviewer must approve the inactive revision and retire the predecessor in one governed transaction.",
        "لا تُستبدل النسخة المعتمدة مباشرة؛ يجب أن يعتمد مراجع سريري مستقل المسودة غير الفعالة ويوقف النسخة السابقة في معاملة واحدة مضبوطة.",
      )}>
      {open && <form className="catalog-form" onSubmit={e => void submit(e)}>
    <label>{tr("Approved source version", "النسخة المعتمدة الأصلية")}
      <select value={id} onChange={e => choose(e.target.value)}>
        {sources.map(source => <option key={source.id} value={source.id}>
          {source.code} — v{source.revisionNumber} ({source.target})
        </option>)}
      </select>
    </label>
    {current && <div className="form-span">
      <p className="muted">{tr("Scope", "النطاق")}: {current.scope} · {tr("Target", "الهدف")}: {current.target}</p>
      <p className="muted">{tr("Original revision recorded", "تسجيل النسخة المعتمدة الأصلية")}: <SystemDateText value={current.createdAt} timeZone="UTC" /> UTC</p>
      <strong>{tr("Approved source text (read-only)", "النص المعتمد الحالي (للقراءة فقط)")}</strong>
      <div dir="ltr" style={{ whiteSpace: "pre-wrap" }}>{current.textEn}</div>
      <div dir="rtl" style={{ whiteSpace: "pre-wrap" }}>{current.textAr || "—"}</div>
      <p className="muted">{tr(
        "The source remains active until independent approval of the new revision.",
        "تبقى النسخة الأصلية فعالة حتى الاعتماد المستقل للنسخة الجديدة.",
      )}</p>
    </div>}
    <label>{tr("Revised name (English)", "الاسم الجديد بالإنجليزية")}
      <input required maxLength={220} value={nameEn} onChange={e=>setNameEn(e.target.value)} />
    </label>
    <label>{tr("Revised name (Arabic)", "الاسم الجديد بالعربية")}
      <input dir="rtl" maxLength={220} value={nameAr} onChange={e=>setNameAr(e.target.value)} />
    </label>
    <label className="form-span">{tr("Revised clinical text (English)", "نص التعليق الجديد بالإنجليزية")}
      <textarea required rows={5} maxLength={5000} dir="ltr" value={textEn}
        onChange={e=>setTextEn(e.target.value)} />
    </label>
    <label className="form-span">{tr("Revised clinical text (Arabic)", "نص التعليق الجديد بالعربية")}
      <textarea rows={5} maxLength={5000} dir="rtl" value={textAr}
        onChange={e=>setTextAr(e.target.value)} />
    </label>
    <label className="form-span">{tr("Documented change reason (minimum 10 characters)", "سبب التصحيح الموثّق (10 أحرف على الأقل)")}
      <textarea required minLength={10} maxLength={1000} rows={3} value={reason}
        onChange={e=>setReason(e.target.value)} />
    </label>
    <button type="submit" className="primary-button form-span" disabled={busy || !current}>
      {busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create inactive revision", "إنشاء نسخة جديدة غير مفعلة")}
    </button>
    {message && <p className="form-warning form-span" role="alert">{message}</p>}
  </form>}
  </CrudModal>
  </>;
}
