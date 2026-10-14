"use client";

import { useRef, useState } from "react";
import { legacyRowTargets, type LegacyRowClassification } from "@/lib/catalog-legacy-row-lineage";

type SourceKey = { sourceSha256: string; tableName: string; digestKeyId: string };
type LineageRow = {
  id: string; rowDigest: string; occurrence: number; revision: number;
  sourceTable: string; classification: LegacyRowClassification;
  targetType: string | null; targetId: string | null;
  batchId: string | null; importRowId: string | null;
  reason: string | null; reviewedAt: string | null;
};
type Review = {
  rows: LineageRow[]; nextAfter: number | null;
  counts: Array<{ classification: string; count: number }>;
  sourceIndependentlyVerified: false; rowParityCertified: false;
  clinicalApproved: false; financialApproved: false; activated: false;
  error?: string;
};
type Admission = { status?: string; received?: number; created?: number; error?: string };
const MAX_UPLOAD = 256 * 1024;
const stages: LegacyRowClassification[] = [
  "UNRESOLVED", "AMBIGUOUS", "NOT_IMPORTED", "MAPPED", "APPROVED_MAPPING",
];

export function LegacyRowLineageReview({ locale }: { locale: "ar" | "en" }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const input = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState<SourceKey | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [cursor, setCursor] = useState(0);
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [selected, setSelected] = useState<LineageRow | null>(null);
  const [classification, setClassification] = useState<LegacyRowClassification>("UNRESOLVED");
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [importRowId, setImportRowId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load(source: SourceKey, after: number) {
    const url = new URLSearchParams({ ...source, after: String(after) });
    const response = await fetch("/api/catalog/legacy-row-lineage?" + url, { cache: "no-store" });
    const parsed = await response.json() as Review;
    if (!response.ok || parsed.rowParityCertified !== false)
      throw Error(parsed.error || "lineage_review_failed");
    setKey(source); setReview(parsed); setCursor(after); setSelected(null);
  }
  async function upload(file: File) {
    if (busy) return;
    setError(""); setAdmission(null);
    if (!file.name.toLowerCase().endsWith(".json") || file.size === 0 || file.size > MAX_UPLOAD) {
      setError(tr("Select a row-hash JSON file (maximum 256 KB).",
        "اختر ملف بصمات الصفوف JSON بحجم لا يتجاوز 256 كيلوبايت."));
      return;
    }
    setBusy(true);
    try {
      const metadata = JSON.parse(await file.text()) as Partial<SourceKey>;
      if (!metadata.sourceSha256 || !metadata.tableName || !metadata.digestKeyId)
        throw Error("invalid_source_hash_manifest");
      const response = await fetch("/api/catalog/legacy-row-lineage", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: file, cache: "no-store",
      });
      const result = await response.json() as Admission;
      if (!response.ok || result.status !== "review_only")
        throw Error(result.error || "lineage_upload_failed");
      setAdmission(result);
      await load({ sourceSha256: metadata.sourceSha256, tableName: metadata.tableName,
        digestKeyId: metadata.digestKeyId }, 0);
    } catch (failure) {
      setError(tr("Source hashes could not be staged: ", "تعذر تسجيل بصمات المصدر: ") +
        (failure instanceof Error ? failure.message : "lineage_upload_failed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  function edit(row: LineageRow) {
    setSelected(row); setClassification(row.classification);
    setTargetType(row.targetType || ""); setTargetId(row.targetId || "");
    setBatchId(row.batchId || ""); setImportRowId(row.importRowId || "");
    setReason(""); setError("");
  }
  async function decide() {
    if (!selected || !key || busy) return;
    setBusy(true); setError("");
    try {
      const body = {
        id: selected.id, expectedRevision: selected.revision, classification, reason,
        targetType: classification === "MAPPED" || classification === "APPROVED_MAPPING"
          ? targetType : null,
        targetId: classification === "MAPPED" || classification === "APPROVED_MAPPING"
          ? targetId || null : null,
        batchId: batchId || null, importRowId: importRowId || null,
      };
      const response = await fetch("/api/catalog/legacy-row-lineage", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), cache: "no-store",
      });
      const out = await response.json() as { error?: string; revision?: number };
      if (!response.ok || typeof out.revision !== "number")
        throw Error(out.error || "lineage_decision_failed");
      await load(key, cursor);
      setReason("");
    } catch (failure) {
      setError(tr("Mapping decision failed: ", "فشل قرار المطابقة: ") +
        (failure instanceof Error ? failure.message : "lineage_decision_failed"));
    } finally { setBusy(false); }
  }
  return <section className="detail-section" dir={locale === "ar" ? "rtl" : "ltr"}>
    <h2>{tr("Access row-by-row provenance and mapping review",
      "إثبات مصدر كل صف في Access ومراجعة المطابقة")}</h2>
    <p className="muted">{tr(
      "The private Windows exporter writes keyed row fingerprints, not raw names, prices, ranges or patient data. Row counts alone do not establish source parity. A reviewed mapping is NOT approval to activate clinical ranges, templates or financial prices.",
      "أداة Windows الخاصة تنتج بصمات محمية بمفتاح للصفوف دون أسماء أو أسعار أو مديات أو بيانات مرضى. تساوي الأعداد لا يثبت تطابق الصفوف. مراجعة المطابقة ليست تصريحاً بتفعيل المديات أو القوالب أو الأسعار."
    )}</p>
    <p className="muted">{tr(
      "Requires organization-wide catalog access. Reviewer of a mapped row must be different from its source author and mapper; clinical and pricing roles are separately checked.",
      "يتطلب صلاحيات الكتالوج على مستوى المؤسسة. معتمد المطابقة يجب أن يختلف عن صاحب المصدر والمطابق، مع التحقق من صلاحيات البيانات الطبية والمالية بشكل منفصل."
    )}</p>
    <input ref={input} type="file" accept=".json,application/json" hidden
      onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); }}/>
    <button type="button" className="secondary-button" disabled={busy}
      onClick={() => input.current?.click()}>
      {busy ? tr("Processing…", "جارٍ المعالجة…") :
        tr("Import private row fingerprints (JSON)", "استيراد بصمات الصفوف الخاصة (JSON)")}
    </button>
    {admission && <p role="status">{tr("Received", "المستلم")}: {admission.received} ·
      {tr("New", "الجديد")}: {admission.created}</p>}
    {error && <p role="alert">{error}</p>}
    {key && review && <div className="detail-section">
      <h3>{tr("Source table", "جدول المصدر")}: {key.tableName}</h3>
      <p className="muted">{tr("Fingerprint", "البصمة")}: <code>{key.sourceSha256.slice(0, 16)}…</code></p>
      <p role="status">{review.counts.map(c => `${c.classification}: ${c.count}`).join(" · ")}</p>
      <p className="muted"><strong>{tr(
        "REVIEW ONLY — no independent MDB verification, source-row parity certification, medical/financial approval or activation.",
        "للمراجعة فقط — لا يوجد تحقق مستقل من Access أو شهادة مطابقة جميع الصفوف أو اعتماد طبي/مالي أو تفعيل."
      )}</strong></p>
      <div className="table-wrap"><table><thead><tr>
        <th>{tr("Row digest", "بصمة الصف")}</th><th>{tr("Occurrence", "التكرار")}</th>
        <th>{tr("Classification", "التصنيف")}</th><th>{tr("Mapped target", "الهدف المطابق")}</th>
        <th>{tr("Review", "مراجعة")}</th>
      </tr></thead><tbody>{review.rows.map(row => <tr key={row.id}>
        <td><code>{row.rowDigest.slice(0, 12)}…</code></td><td>{row.occurrence}</td>
        <td>{row.classification}</td><td>{row.targetType || "—"} {row.targetId?.slice(0, 8)}</td>
        <td><button type="button" className="secondary-button"
          disabled={busy || row.classification === "APPROVED_MAPPING"} onClick={() => edit(row)}>
          {tr("Classify", "تصنيف")}</button></td>
      </tr>)}</tbody></table></div>
      <div className="action-row">
        <button type="button" disabled={busy || cursor === 0} className="secondary-button"
          onClick={() => void load(key, Math.max(0, cursor - 100))}>
          {tr("Previous", "السابق")}</button>
        <button type="button" disabled={busy || review.nextAfter === null} className="secondary-button"
          onClick={() => review.nextAfter !== null && void load(key, review.nextAfter)}>
          {tr("Next", "التالي")}</button>
      </div>
      {selected && <form onSubmit={event => { event.preventDefault(); void decide(); }}
        className="detail-section">
        <h4>{tr("Classify source row", "تصنيف صف المصدر")} {selected.rowDigest.slice(0, 12)}</h4>
        <label>{tr("Decision", "القرار")}
          <select value={classification}
            onChange={event => setClassification(event.target.value as LegacyRowClassification)}>
            {stages.map(stage => <option key={stage} value={stage}>{stage}</option>)}
          </select>
        </label>
        {(classification === "MAPPED" || classification === "APPROVED_MAPPING") && <>
          <label>{tr("Target type", "نوع الهدف")}
            <select value={targetType} onChange={event => setTargetType(event.target.value)} required>
              <option value="">{tr("Select", "اختر")}</option>
              {(legacyRowTargets[selected.sourceTable] || []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label>{tr("Existing target UUID", "معرف الهدف الحالي")}
            <input value={targetId} onChange={event => setTargetId(event.target.value)} required
              placeholder="00000000-0000-0000-0000-000000000000"/>
          </label>
        </>}
        <label>{tr("Linked staging batch UUID (optional)", "معرف دفعة التجهيز (اختياري)")}
          <input value={batchId} onChange={event => setBatchId(event.target.value)}/></label>
        <label>{tr("Linked staging row UUID (optional)", "معرف صف التجهيز (اختياري)")}
          <input value={importRowId} onChange={event => setImportRowId(event.target.value)}/></label>
        <label>{tr("Documented reconciliation reason", "سبب المطابقة الموثّق")}
          <textarea value={reason} onChange={event => setReason(event.target.value)}
            minLength={12} maxLength={1000} required/></label>
        <button disabled={busy} type="submit" className="secondary-button">
          {tr("Save audited mapping review", "حفظ مراجعة المطابقة وتدقيقها")}
        </button>
      </form>}
    </div>}
  </section>;
}
