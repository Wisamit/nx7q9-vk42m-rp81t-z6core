"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { statusLabel as sharedStatusLabel } from "@/lib/ui-i18n";

type BranchOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
type SpecimenOption = {
  id: string;
  barcode: string;
  status: string;
  currentBranchId: string | null;
  order: { accessionNumber: string; patient: { patientNumber: string; fullNameEn: string; fullNameAr?: string | null } };
  specimenType: { nameEn: string; nameAr?: string | null } | null;
};
type ManifestItem = {
  specimenId: string;
  barcodeSnapshot: string;
  status: string;
  exceptionText?: string | null;
  specimen: {
    order: { accessionNumber: string; patient: { patientNumber: string; fullNameEn: string; fullNameAr?: string | null } };
    specimenType: { nameEn: string; nameAr?: string | null } | null;
  };
};
type Manifest = {
  id: string;
  manifestNumber: string;
  status: string;
  sourceBranch: BranchOption;
  destinationBranch: BranchOption;
  transportMode: string | null;
  courierName: string | null;
  packageCount: number | null;
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  items: ManifestItem[];
};

export function TransferManager({
  branches,
  sourceBranches,
  specimens,
  manifests,
  activeBranchId,
  locale,
}: {
  branches: BranchOption[];
  sourceBranches: BranchOption[];
  specimens: SpecimenOption[];
  manifests: Manifest[];
  activeBranchId: string | null;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [sourceBranchId, setSourceBranchId] = useState(activeBranchId || sourceBranches[0]?.id || "");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [selectedSpecimens, setSelectedSpecimens] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [receiveBarcodes, setReceiveBarcodes] = useState<Record<string, string>>({});
  const [exceptionTypes, setExceptionTypes] = useState<Record<string, string>>({});
  const [exceptionNotes, setExceptionNotes] = useState<Record<string, string>>({});
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const patientName = (item: { fullNameEn: string; fullNameAr?: string | null }) => locale === "ar" ? item.fullNameAr || item.fullNameEn : item.fullNameEn;
  const transferStatusLabel = (value: string) =>
    value === "DRAFT" ? tr("Draft", "مسودة") :
    value === "DISPATCHED" ? tr("Dispatched", "تم الإرسال") :
    value === "PARTIALLY_RECEIVED" ? tr("Partially received", "مستلم جزئياً") :
    value === "RECEIVED" ? tr("Received", "تم الاستلام") :
    value === "CANCELLED" ? tr("Cancelled", "ملغى") :
    sharedStatusLabel(locale, value);

  const eligibleSpecimens = useMemo(
    () => specimens.filter((specimen) => specimen.currentBranchId === sourceBranchId),
    [specimens, sourceBranchId],
  );

  async function createManifest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceBranchId || !destinationBranchId || selectedSpecimens.length === 0) {
      setMessage(tr("Select source, destination and at least one specimen.", "اختر الفرع المصدر والوجهة وعينة واحدة على الأقل."));
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy("create"); setMessage("");

    const response = await fetch("/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceBranchId,
        destinationBranchId,
        specimenIds: selectedSpecimens,
        transportMode: form.get("transportMode"),
        courierName: form.get("courierName"),
        packageCount: form.get("packageCount"),
        notes: form.get("notes"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(tr(`Manifest created: ${body.manifest.manifestNumber}`, `تم إنشاء بيان الشحن: ${body.manifest.manifestNumber}`));
      setSelectedSpecimens([]);
      setDestinationBranchId("");
      event.currentTarget.reset();
      router.refresh();
    } else {
      setMessage(tr("Could not create transfer manifest.", "تعذر إنشاء بيان نقل العينات."));
    }
    setBusy("");
  }

  async function dispatch(manifestId: string) {
    if (!confirm(tr("Dispatch this manifest? All included specimens will become IN_TRANSIT.", "هل تريد إرسال بيان الشحن؟ ستصبح جميع العينات المضمنة بحالة IN_TRANSIT."))) return;
    setBusy(`dispatch:${manifestId}`); setMessage("");
    const response = await fetch(`/api/transfers/${manifestId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "DISPATCH" }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? tr("Manifest dispatched.", "تم إرسال بيان الشحن.") : tr("Dispatch failed.", "فشل الإرسال."));
    setBusy("");
    if (response.ok) router.refresh();
  }

  async function receiveItem(manifestId: string) {
    const barcode = receiveBarcodes[manifestId]?.trim();
    if (!barcode) { setMessage(tr("Scan or enter a barcode.", "امسح الباركود أو أدخله.")); return; }
    setBusy(`receive:${manifestId}`); setMessage("");
    const response = await fetch(`/api/transfers/${manifestId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RECEIVE_ITEM", barcode }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr(`${barcode} received. ${body.remaining} item(s) remaining.`, `تم استلام ${barcode}. بقي ${body.remaining} عنصر.`));
      setReceiveBarcodes((values) => ({ ...values, [manifestId]: "" }));
      router.refresh();
    } else {
      setMessage(tr("Receipt failed.", "فشل الاستلام."));
    }
    setBusy("");
  }

  async function reportException(manifestId: string) {
    const barcode = receiveBarcodes[manifestId]?.trim();
    const exceptionType = exceptionTypes[manifestId] || "";
    const exceptionText = exceptionNotes[manifestId]?.trim();
    if (!barcode || !exceptionType || !exceptionText) {
      setMessage(tr("Scan the barcode and select an exception type with a reason.", "امسح الباركود واختر نوع المشكلة واكتب السبب."));
      return;
    }
    setBusy(`exception:${manifestId}`); setMessage("");
    try {
      const response = await fetch(`/api/transfers/${manifestId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REPORT_EXCEPTION", barcode, exceptionType, exceptionText }),
      });
      setMessage(response.ok
        ? tr("Specimen exception recorded and held for reconciliation.", "تم تسجيل مشكلة العينة وحظر استخدامها لحين التسوية.")
        : tr("Could not record the specimen exception.", "تعذر تسجيل مشكلة العينة."));
      if (response.ok) {
        setReceiveBarcodes(values => ({ ...values, [manifestId]: "" }));
        setExceptionNotes(values => ({ ...values, [manifestId]: "" }));
        router.refresh();
      }
    } catch {
      setMessage(tr("Network error while reporting the exception.", "حدث خطأ بالشبكة أثناء تسجيل المشكلة."));
    } finally {
      setBusy("");
    }
  }

  return <div className="transfer-layout">
    <section className="detail-card">
      <h2>{tr("Create Transfer Manifest","إنشاء بيان نقل")}</h2>
      <form className="catalog-form" onSubmit={createManifest}>
        <label>{tr("Source branch","الفرع المصدر")}
          <select value={sourceBranchId} onChange={(e) => { setSourceBranchId(e.target.value); setSelectedSpecimens([]); }} required>
            <option value="">{tr("Select source…","اختر الفرع المصدر…")}</option>
            {sourceBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}
          </select>
        </label>
        <label>{tr("Destination branch","الفرع الوجهة")}
          <select value={destinationBranchId} onChange={(e) => setDestinationBranchId(e.target.value)} required>
            <option value="">{tr("Select destination…","اختر الفرع الوجهة…")}</option>
            {branches.filter(branch => branch.id !== sourceBranchId).map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}
          </select>
        </label>
        <label>{tr("Transport mode","وسيلة النقل")}<input name="transportMode" placeholder={tr("Courier / internal transport / driver","شركة نقل / نقل داخلي / سائق")} /></label>
        <label>{tr("Courier / driver","شركة النقل / السائق")}<input name="courierName" /></label>
        <label>{tr("Package count","عدد الطرود")}<input name="packageCount" type="number" min="1" max="9999" /></label>
        <label className="form-span">{tr("Notes","ملاحظات")}<textarea name="notes" rows={2} /></label>

        <div className="form-span">
          <strong>{tr("Eligible specimens at source branch","العينات المؤهلة في الفرع المصدر")}</strong>
          <div className="transfer-specimen-selector">
            {eligibleSpecimens.length === 0 ? <p className="muted">{tr("No collected or received specimens available for transfer.","لا توجد عينات مجمعة أو مستلمة متاحة للنقل.")}</p> :
              eligibleSpecimens.map(specimen => <label className="transfer-specimen-option" key={specimen.id}>
                <input
                  type="checkbox"
                  checked={selectedSpecimens.includes(specimen.id)}
                  onChange={(e) => setSelectedSpecimens(ids => e.target.checked ? [...ids, specimen.id] : ids.filter(id => id !== specimen.id))}
                />
                <span><strong>{specimen.barcode}</strong><small>{specimen.specimenType ? localizedName(specimen.specimenType) : tr("Specimen","عينة")} · {specimen.order.accessionNumber} · {specimen.order.patient.patientNumber} · {patientName(specimen.order.patient)}</small></span>
              </label>)
            }
          </div>
        </div>

        <button className="primary-button form-span" disabled={busy === "create"}>{busy === "create" ? tr("Creating…","جارٍ الإنشاء…") : tr(`Create Manifest (${selectedSpecimens.length})`,`إنشاء بيان (${selectedSpecimens.length})`)}</button>
      </form>
      {message && <p className="form-success">{message}</p>}
    </section>

    <section className="transfer-manifest-list">
      {manifests.length === 0 ? <article className="detail-card"><p className="empty-state">{tr("No transfer manifests yet.","لا توجد بيانات نقل بعد.")}</p></article> :
        manifests.map(manifest => {
          const received = manifest.items.filter(item => item.status === "RECEIVED").length;
          return <article className="detail-card transfer-manifest-card" key={manifest.id}>
            <div className="specimen-card-head">
              <div>
                <p className="eyebrow">{transferStatusLabel(manifest.status)}</p>
                <h2>{manifest.manifestNumber}</h2>
                <p className="muted">{manifest.sourceBranch.code} → {manifest.destinationBranch.code} · {received}/{manifest.items.length} {tr("received","مستلم")}</p>
              </div>
              {manifest.status === "DRAFT" && <button className="primary-button" disabled={busy === `dispatch:${manifest.id}`} onClick={() => void dispatch(manifest.id)}>{tr("Dispatch","إرسال")}</button>}
            </div>

            <div className="specimen-metadata">
              <div><span>{tr("Transport","النقل")}</span><strong>{manifest.transportMode || "—"}</strong></div>
              <div><span>{tr("Courier","شركة النقل / السائق")}</span><strong>{manifest.courierName || "—"}</strong></div>
              <div><span>{tr("Packages","الطرود")}</span><strong>{manifest.packageCount || "—"}</strong></div>
              <div><span>{tr("Dispatched","تم الإرسال")}</span><strong>{manifest.dispatchedAt ? manifest.dispatchedAt.replace("T"," ").slice(0,19) : "—"}</strong></div>
              <div><span>{tr("Received","تم الاستلام")}</span><strong>{manifest.receivedAt ? manifest.receivedAt.replace("T"," ").slice(0,19) : "—"}</strong></div>
            </div>

            <div className="transfer-items">
              {manifest.items.map(item => <div className="transfer-item-row" key={item.specimenId}>
                <span><strong>{item.barcodeSnapshot}</strong><small>{item.specimen.specimenType ? localizedName(item.specimen.specimenType) : tr("Specimen","عينة")} · {item.specimen.order.accessionNumber} · {patientName(item.specimen.order.patient)}</small></span>
                <strong>{transferStatusLabel(item.status)}{item.exceptionText ? <small> · {item.exceptionText}</small> : null}</strong>
              </div>)}
            </div>

            {["DISPATCHED","PARTIALLY_RECEIVED"].includes(manifest.status) && <div className="transfer-receive-box">
              <input
                value={receiveBarcodes[manifest.id] || ""}
                onChange={(e) => setReceiveBarcodes(values => ({ ...values, [manifest.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void receiveItem(manifest.id); } }}
                placeholder={tr("Scan specimen barcode to receive…","امسح باركود العينة لاستلامها…")}
              />
              <button className="primary-button" type="button" disabled={Boolean(busy)} onClick={() => void receiveItem(manifest.id)}>{tr("Receive Item","استلام العينة")}</button>
              <label>{tr("Exception type", "نوع مشكلة الاستلام")}
                <select value={exceptionTypes[manifest.id] || ""} onChange={event => setExceptionTypes(values => ({ ...values, [manifest.id]: event.target.value }))}>
                  <option value="">{tr("Select an exception", "اختر نوع المشكلة")}</option>
                  <option value="MISSING">{tr("Specimen missing", "العينة مفقودة")}</option>
                  <option value="DAMAGED">{tr("Damaged specimen", "العينة تالفة")}</option>
                  <option value="LABEL_MISMATCH">{tr("Label mismatch", "عدم تطابق الملصق")}</option>
                  <option value="TEMPERATURE_FAILURE">{tr("Temperature excursion", "خلل بدرجة الحرارة")}</option>
                  <option value="OTHER">{tr("Other", "أخرى")}</option>
                </select>
              </label>
              <label>{tr("Document discrepancy", "تفاصيل المشكلة")}
                <input value={exceptionNotes[manifest.id] || ""} onChange={event => setExceptionNotes(values => ({ ...values, [manifest.id]: event.target.value }))} maxLength={400} placeholder={tr("Describe observed discrepancy", "صف المشكلة عند الاستلام")} />
              </label>
              <button className="danger-button" type="button" disabled={Boolean(busy)} onClick={() => void reportException(manifest.id)}>{tr("Report exception / hold", "تسجيل مشكلة / حجز العينة")}</button>
            </div>}
          </article>;
        })
      }
    </section>
  </div>;
}
