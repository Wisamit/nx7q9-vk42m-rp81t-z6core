"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ lotId: "", requestedQty: "" }]);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
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
    const form = new FormData(event.currentTarget);
    setBusy("create");
    setMessage("");
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
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? tr("Stock transfer request created.", "تم إنشاء طلب نقل المخزون.") : tr("Could not create transfer.", "تعذر إنشاء طلب النقل."));
    if (response.ok) {
      event.currentTarget.reset();
      setSourceBranchId("");
      setDestinationBranchId("");
      setLines([{ lotId: "", requestedQty: "" }]);
      router.refresh();
    }
  }

  async function simpleAction(transferId: string, action: "approve" | "dispatch") {
    if (!window.confirm(action === "approve" ? tr("Approve this transfer and reserve the requested stock?", "هل تريد الموافقة على هذا النقل وحجز المخزون المطلوب؟") : tr("Dispatch this transfer and remove the reserved stock from the source branch?", "هل تريد إرسال هذا النقل وخصم المخزون المحجوز من الفرع المصدر؟"))) return;
    setBusy(transferId + action);
    setMessage("");
    const response = await fetch(`/api/inventory/transfers/${transferId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: action === "approve" ? JSON.stringify({}) : undefined,
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? (action === "approve" ? tr("Transfer approval completed.", "تمت الموافقة على النقل.") : tr("Transfer dispatch completed.", "تم إرسال النقل.")) : tr("Action failed.", "فشلت العملية."));
    if (response.ok) router.refresh();
  }

  async function receive(transfer: Transfer, finalize: boolean) {
    if (finalize && !window.confirm(tr("Finalize receipt? Any difference between dispatched and received quantities will be recorded as discrepancy.", "هل تريد إنهاء الاستلام؟ أي فرق بين الكمية المرسلة والمستلمة سيُسجل كفرق."))) return;
    const items = transfer.items.map(line => {
      const dispatched = Number(line.dispatchedQty || "0");
      const received = Number(line.receivedQty || "0");
      const remaining = Math.max(0, dispatched - received);
      return {
        transferItemId: line.id,
        receivedQty: receiveQty[line.id] === undefined ? remaining.toString() : receiveQty[line.id],
      };
    });
    setBusy(transfer.id + (finalize ? "final" : "receive"));
    setMessage("");
    const response = await fetch(`/api/inventory/transfers/${transfer.id}/receive`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finalize, items }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? (finalize ? tr("Transfer receipt finalized.", "تم إنهاء استلام النقل.") : tr("Partial receipt posted.", "تم ترحيل استلام جزئي.")) : tr("Receipt failed.", "فشل الاستلام."));
    if (response.ok) {
      setReceiveQty({});
      router.refresh();
    }
  }

  return <>
    <section className="detail-card detail-section">
      <h2>{tr("Request Stock Transfer", "طلب نقل مخزون")}</h2>
      <p className="muted">{tr("The destination branch requests stock. Source stock is only reserved after approval and only deducted on dispatch.", "الفرع الوجهة يطلب المخزون. لا يُحجز مخزون المصدر إلا بعد الموافقة ولا يُخصم إلا عند الإرسال.")}</p>
      <form className="catalog-form" onSubmit={createTransfer}>
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
                    {sourceLots.map(stock => <option key={stock.lotId} value={stock.lotId}>{stock.itemCode} — {stock.lotNumber} · {tr("Available", "المتاح")} {stock.availableQty} {stock.stockUnit}{stock.expiryDate ? " · " + tr("Exp", "انتهاء") + " " + stock.expiryDate : ""}</option>)}
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
      </form>
      {message && <div className="form-success">{message}</div>}
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
            {transfer.status === "DRAFT" && transfer.canSourceAct && <button type="button" className="secondary-button" disabled={busy !== ""} onClick={() => void simpleAction(transfer.id, "approve")}>{tr("Approve & Reserve", "موافقة وحجز")}</button>}
            {transfer.status === "APPROVED" && transfer.canSourceAct && <button type="button" className="primary-button" disabled={busy !== ""} onClick={() => void simpleAction(transfer.id, "dispatch")}>{tr("Dispatch", "إرسال")}</button>}
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
          <button type="button" className="secondary-button" disabled={busy !== ""} onClick={() => void receive(transfer, false)}>{tr("Post Partial Receipt", "ترحيل استلام جزئي")}</button>
          <button type="button" className="primary-button" disabled={busy !== ""} onClick={() => void receive(transfer, true)}>{tr("Finalize Receipt", "إنهاء الاستلام")}</button>
        </div>}
      </article>)}
    </section>
  </>;
}
