"use client";

import { FormEvent, useMemo, useState, useSyncExternalStore } from "react";
import { normalizeSystemDateFormat } from "@/lib/system-date";
import { formatCalendarDisplay } from "@/lib/system-date-display";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { statusLabel as sharedStatusLabel } from "@/lib/ui-i18n";

type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type LotStock = {
  branchId: string;
  lotId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  lotNumber: string;
  expiryDate: string | null;
  availableQty: string;
  stockUnit: string;
};
type Transfer = {
  id: string;
  transferNumber: string;
  sourceBranchId: string;
  destinationBranchId: string;
  sourceBranchName: string;
  destinationBranchName: string;
  status: string;
  canSourceAct: boolean;
  canDestinationAct: boolean;
  items: Array<{
    id: string;
    itemCode: string;
    itemName: string;
    lotNumber: string;
    requestedQty: string;
    approvedQty: string | null;
    dispatchedQty: string | null;
    receivedQty: string | null;
    discrepancyQty: string | null;
  }>;
};

type DraftLine = { lotId: string; requestedQty: string };

const subscribeDateFormat = () => () => {};
const readDateFormat = () => document.documentElement.dataset.dateFormat || "DD/MM/YYYY";
const serverDateFormat = () => "DD/MM/YYYY";

export function InventoryTransferManager({
  branches,
  lotStocks,
  transfers,
  locale,
}: {
  branches: Branch[];
  lotStocks: LotStock[];
  transfers: Transfer[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const dateFormat = normalizeSystemDateFormat(useSyncExternalStore(subscribeDateFormat, readDateFormat, serverDateFormat));
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ lotId: "", requestedQty: "" }]);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  type TransferReview = { transferId: string; action: "approve" | "dispatch" | "receive" | "finalize";
    items: Array<{transferItemId:string;receivedQty:string}> };
  const [review, setReview] = useState<TransferReview | null>(null);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const branchName = (branch: Branch) => locale === "ar" ? branch.nameAr || branch.nameEn : branch.nameEn;
  const statusLabel = (value: string) => sharedStatusLabel(locale, value);

  const sourceLots = useMemo(
    () => lotStocks.filter(stock => stock.branchId === sourceBranchId),
    [lotStocks, sourceBranchId],
  );
  const lotById = useMemo(() => new Map(lotStocks.map(stock => [stock.lotId, stock])), [lotStocks]);

  function updateLine(index: number, field: keyof DraftLine, value: string) {
    setLines(current => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }

  async function createTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("create");
    setFormError("");
    try {
      const response = await fetch("/api/inventory/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transferNumber: form.get("transferNumber"),
          sourceBranchId,
          destinationBranchId,
          notes: form.get("notes"),
          items: lines.map(line => {
            const stock = lotById.get(line.lotId);
            return { itemId: stock?.itemId || "", lotId: line.lotId, requestedQty: line.requestedQty };
          }),
        }),
      });
      const body = await response.json().catch(() => ({})) as {error?:string};
      if (!response.ok) {
        setFormError(body.error || tr("Could not create transfer.", "تعذر إنشاء طلب النقل."));
        return;
      }
      setMessage(tr("Stock transfer request created.", "تم إنشاء طلب نقل المخزون."));
      setCreateOpen(false);
      setSourceBranchId("");
      setDestinationBranchId("");
      setLines([{ lotId: "", requestedQty: "" }]);
      router.refresh();
    } catch {
      setFormError(tr("Connection interrupted; verify stock transfer status before retrying.",
        "انقطع الاتصال؛ تحقق من حالة نقل المخزون قبل إعادة المحاولة."));
    } finally {
      setBusy("");
    }
  }

  function openReview(transfer: Transfer, action: TransferReview["action"]) {
    if (busy) return;
    if ((action === "approve" && (transfer.status !== "DRAFT" || !transfer.canSourceAct)) ||
      (action === "dispatch" && (transfer.status !== "APPROVED" || !transfer.canSourceAct)) ||
      ((action === "receive" || action === "finalize") &&
        (!["DISPATCHED","PARTIALLY_RECEIVED"].includes(transfer.status) || !transfer.canDestinationAct))) return;
    const items = (action === "receive" || action === "finalize") ? transfer.items.map(line => {
      const dispatched = Number(line.dispatchedQty || "0");
      const received = Number(line.receivedQty || "0");
      const remaining = Math.max(0, dispatched - received);
      return {
        transferItemId: line.id,
        receivedQty: receiveQty[line.id] === undefined ? remaining.toString() : receiveQty[line.id],
      };
    }) : [];
    setFormError("");
    setMessage("");
    setReview({transferId:transfer.id, action, items});
  }

  async function confirmReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!review || busy) return;
    const transfer = transfers.find(item=>item.id===review.transferId);
    if (!transfer || (review.action==="approve" && (transfer.status!=="DRAFT" || !transfer.canSourceAct)) ||
      (review.action==="dispatch" && (transfer.status!=="APPROVED" || !transfer.canSourceAct)) ||
      ((review.action==="receive" || review.action==="finalize") &&
        (!["DISPATCHED","PARTIALLY_RECEIVED"].includes(transfer.status) || !transfer.canDestinationAct))) {
      setFormError(tr("Transfer state changed. Refresh before retrying.",
        "تغيّرت حالة النقل؛ حدّث الصفحة قبل إعادة المحاولة."));
      return;
    }
    const action = review.action;
    const isReceipt = action==="receive" || action==="finalize";
    const key=review.transferId+action;
    setBusy(key); setFormError("");
    try {
      const url=isReceipt
        ? `/api/inventory/transfers/${review.transferId}/receive`
        : `/api/inventory/transfers/${review.transferId}/${action}`;
      const response=await fetch(url,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:isReceipt ? JSON.stringify({finalize:action==="finalize",items:review.items})
          : action==="approve" ? JSON.stringify({}) : undefined,
      });
      const body=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){
        setFormError(body.error || tr("Transfer action failed.", "فشل إجراء نقل المخزون."));
        return;
      }
      setReview(null);
      setMessage(action==="approve" ? tr("Transfer approval completed.","تمت الموافقة على النقل.")
        : action==="dispatch" ? tr("Transfer dispatch completed.","تم إرسال النقل.")
        : action==="finalize" ? tr("Transfer receipt finalized.","تم إنهاء استلام النقل.")
        : tr("Partial receipt posted.","تم ترحيل استلام جزئي."));
      if(isReceipt) setReceiveQty({});
      router.refresh();
    }catch{
      setFormError(tr("Connection interrupted; verify custody and stock before retrying.",
        "انقطع الاتصال؛ تحقق من الحيازة والمخزون قبل إعادة المحاولة."));
    }finally{setBusy("");}
  }

  return <>
    <section className="detail-card detail-section">
      <h2>{tr("Request Stock Transfer", "طلب نقل مخزون")}</h2>
      <p className="muted">{tr("The destination branch requests stock. Source stock is only reserved after approval and only deducted on dispatch.", "الفرع الوجهة يطلب المخزون. لا يُحجز مخزون المصدر إلا بعد الموافقة ولا يُخصم إلا عند الإرسال.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
        onClick={() => {setMessage("");setFormError("");setCreateOpen(true);}}>
        {tr("Create Stock Transfer Request", "إنشاء طلب نقل مخزون")}
      </button>
      <CrudModal open={createOpen} onClose={()=>{if(!busy)setCreateOpen(false);}}
        size="compact"
        title={tr("Create Stock Transfer Request", "إنشاء طلب نقل مخزون")}
        description={tr(
          "Choose exact source/destination branches and traceable lots. Source stock is reserved only on approval, and deducted only on dispatch.",
          "اختر الفروع والتشغيلات القابلة للتتبع بدقة. يُحجز مخزون المصدر عند الاعتماد فقط، ويُخصم عند الإرسال فقط.",
        )}>
        {createOpen&&<form className="catalog-form" onSubmit={createTransfer}>
        <label>{tr("Transfer number", "رقم النقل")}<input name="transferNumber" required /></label>
        <label>{tr("Source branch", "الفرع المصدر")}<select required value={sourceBranchId} onChange={event => {
          setSourceBranchId(event.target.value);
          setLines([{ lotId: "", requestedQty: "" }]);
        }}><option value="">{tr("Select source…", "اختر الفرع المصدر…")}</option>{branches.filter(branch => branch.id !== destinationBranchId).map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branchName(branch)}</option>)}</select></label>
        <label>{tr("Destination branch", "الفرع الوجهة")}<select required value={destinationBranchId} onChange={event => setDestinationBranchId(event.target.value)}><option value="">{tr("Select destination…", "اختر الفرع الوجهة…")}</option>{branches.filter(branch => branch.id !== sourceBranchId).map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branchName(branch)}</option>)}</select></label>
        <label className="form-span">{tr("Notes", "ملاحظات")}<textarea name="notes" rows={2} /></label>

        <div className="form-span">
          <h3>{tr("Lots & Quantities", "التشغيلات والكميات")}</h3>
          <div className="reflex-list">
            {lines.map((line, index) => {
              const selected = lotById.get(line.lotId);
              return <div className="reflex-card" key={index}>
                <div className="catalog-form" style={{ flex: 1 }}>
                  <label>{tr("Lot", "التشغيلة")}<select value={line.lotId} required disabled={!sourceBranchId} onChange={event => updateLine(index, "lotId", event.target.value)}>
                    <option value="">{tr("Select lot…", "اختر التشغيلة…")}</option>
                    {sourceLots.map(stock => <option key={stock.lotId} value={stock.lotId}>{stock.itemCode} — {stock.lotNumber} · {tr("Available", "المتاح")} {stock.availableQty} {stock.stockUnit}{stock.expiryDate ? " · " + tr("Exp", "انتهاء") + " " + formatCalendarDisplay(stock.expiryDate, dateFormat) : ""}</option>)}
                  </select></label>
                  <label>{tr("Requested quantity", "الكمية المطلوبة")}<input type="number" min="0.0001" step="0.0001" value={line.requestedQty} required onChange={event => updateLine(index, "requestedQty", event.target.value)} /></label>
                  {selected && <small className="muted">{selected.itemName} · {tr("Available", "المتاح")} {selected.availableQty} {selected.stockUnit}</small>}
                </div>
                {lines.length > 1 && <button type="button" className="secondary-button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}>{tr("Remove", "إزالة")}</button>}
              </div>;
            })}
          </div>
          <button type="button" className="secondary-button" disabled={!sourceBranchId} onClick={() => setLines(current => [...current, { lotId: "", requestedQty: "" }])}>{tr("Add Lot", "إضافة تشغيلة")}</button>
        </div>

        <button className="primary-button form-span" disabled={busy !== "" || !sourceBranchId || !destinationBranchId}>{busy === "create" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Transfer Request", "إنشاء طلب النقل")}</button>
        {formError&&<p className="form-error form-span" role="alert">{formError}</p>}
      </form>}
      </CrudModal>
      {message && <div className="form-success" role="status">{message}</div>}
    </section>

    <section className="transfer-manifest-list detail-section">
      {transfers.length === 0 ? <article className="detail-card"><p className="empty-state">{tr("No inventory transfers found.", "لا توجد عمليات نقل مخزون.")}</p></article> : transfers.map(transfer => <article className="detail-card transfer-manifest-card" key={transfer.id}>
        <div className="specimen-card-head">
          <div>
            <span className="eyebrow">{statusLabel(transfer.status)}</span>
            <h3>{transfer.transferNumber}</h3>
            <p className="muted">{transfer.sourceBranchName} → {transfer.destinationBranchName}</p>
          </div>
          <div className="result-actions">
            {transfer.status === "DRAFT" && transfer.canSourceAct && <button type="button" className="secondary-button" disabled={busy !== ""} onClick={() => openReview(transfer, "approve")}>{tr("Approve & Reserve", "موافقة وحجز")}</button>}
            {transfer.status === "APPROVED" && transfer.canSourceAct && <button type="button" className="primary-button" disabled={busy !== ""} onClick={() => openReview(transfer, "dispatch")}>{tr("Dispatch", "إرسال")}</button>}
          </div>
        </div>

        <div className="transfer-items">
          {transfer.items.map(line => {
            const dispatched = Number(line.dispatchedQty || "0");
            const received = Number(line.receivedQty || "0");
            const remaining = Math.max(0, dispatched - received);
            return <div className="transfer-item-row" key={line.id}>
              <span>
                <strong>{line.itemCode} — {line.itemName}</strong>
                <small>{tr("Lot", "التشغيلة")} {line.lotNumber}</small>
                <small>{tr("Requested", "مطلوب")} {line.requestedQty} · {tr("Approved", "معتمد")} {line.approvedQty || "—"} · {tr("Dispatched", "مرسل")} {line.dispatchedQty || "—"} · {tr("Received", "مستلم")} {line.receivedQty || "0"} · {tr("Discrepancy", "الفرق")} {line.discrepancyQty || "—"}</small>
              </span>
              {["DISPATCHED","PARTIALLY_RECEIVED"].includes(transfer.status) && transfer.canDestinationAct && <input
                type="number"
                min="0"
                max={remaining}
                step="0.0001"
                value={receiveQty[line.id] ?? remaining.toString()}
                onChange={event => setReceiveQty(current => ({ ...current, [line.id]: event.target.value }))}
                aria-label={tr(`Receive quantity for ${line.itemCode}`, `كمية الاستلام للصنف ${line.itemCode}`)}
              />}
            </div>;
          })}
        </div>

        {["DISPATCHED","PARTIALLY_RECEIVED"].includes(transfer.status) && transfer.canDestinationAct && <div className="result-actions">
          <button type="button" className="secondary-button" disabled={busy !== ""} onClick={() => openReview(transfer, "receive")}>{tr("Post Partial Receipt", "ترحيل استلام جزئي")}</button>
          <button type="button" className="primary-button" disabled={busy !== ""} onClick={() => openReview(transfer, "finalize")}>{tr("Finalize Receipt", "إنهاء الاستلام")}</button>
        </div>}
      </article>)}
    </section>
    <CrudModal open={review!==null} onClose={()=>{if(!busy)setReview(null);}}
      size="compact"
      title={review?.action==="approve" ? tr("Approve and Reserve Stock", "اعتماد وحجز المخزون")
        :review?.action==="dispatch" ? tr("Dispatch Reserved Stock", "إرسال المخزون المحجوز")
        :review?.action==="finalize" ? tr("Finalize Stock Receipt", "إنهاء استلام المخزون")
        :tr("Post Partial Receipt", "ترحيل استلام جزئي")}
      description={tr(
        "Stock, lots and chain-of-custody records change on confirmation. Verify exact quantities and source/destination branches.",
        "تتغير سجلات المخزون والتشغيلات والحيازة عند التأكيد؛ راجع الكميات والفروع بدقة.",
      )}>
      {review&&<form className="catalog-form" onSubmit={confirmReview}>
        {(() => {
          const transfer=transfers.find(item=>item.id===review.transferId);
          return <div className="form-span">
            <strong>{transfer?.transferNumber || tr("Transfer unavailable","النقل غير متاح")}</strong>
            <p>{transfer?.sourceBranchName} → {transfer?.destinationBranchName}</p>
            {transfer?.items.map(line=>{
              const requested=review.items.find(item=>item.transferItemId===line.id);
              return <p key={line.id}>
                {line.itemCode} · {line.lotNumber} · {tr("Dispatched","مرسل")}: {line.dispatchedQty||"—"}
                {requested&&<> · {tr("Receiving","قيد الاستلام")}: {requested.receivedQty}</>}
              </p>;
            })}
            {review.action==="finalize"&&<p className="form-warning">
              {tr("Any dispatched/received difference will be recorded as a discrepancy.",
                "سيتم توثيق أي فرق بين الكميات المرسلة والمستلمة كاختلاف رسمي.")}
            </p>}
          </div>;
        })()}
        {formError&&<p className="form-error form-span" role="alert">{formError}</p>}
        <button type="submit" className="primary-button form-span" disabled={Boolean(busy)}>
          {busy?tr("Processing…","جارٍ التنفيذ…"):tr("Confirm recorded transfer action","تأكيد إجراء نقل المخزون")}
        </button>
      </form>}
    </CrudModal>
  </>;
}
