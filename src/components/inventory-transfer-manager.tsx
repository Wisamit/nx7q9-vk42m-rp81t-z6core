"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string };
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
}: {
  branches: Branch[];
  lotStocks: LotStock[];
  transfers: Transfer[];
}) {
  const router = useRouter();
  const [sourceBranchId, setSourceBranchId] = useState("");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ lotId: "", requestedQty: "" }]);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

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
    setMessage(response.ok ? "Stock transfer request created." : body.error || "Could not create transfer.");
    if (response.ok) {
      event.currentTarget.reset();
      setSourceBranchId("");
      setDestinationBranchId("");
      setLines([{ lotId: "", requestedQty: "" }]);
      router.refresh();
    }
  }

  async function simpleAction(transferId: string, action: "approve" | "dispatch") {
    if (!window.confirm(action === "approve" ? "Approve this transfer and reserve the requested stock?" : "Dispatch this transfer and remove the reserved stock from the source branch?")) return;
    setBusy(transferId + action);
    setMessage("");
    const response = await fetch(`/api/inventory/transfers/${transferId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: action === "approve" ? JSON.stringify({}) : undefined,
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? `Transfer ${action} completed.` : body.error || "Action failed.");
    if (response.ok) router.refresh();
  }

  async function receive(transfer: Transfer, finalize: boolean) {
    if (finalize && !window.confirm("Finalize receipt? Any difference between dispatched and received quantities will be recorded as discrepancy.")) return;
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
    setMessage(response.ok ? (finalize ? "Transfer receipt finalized." : "Partial receipt posted.") : body.error || "Receipt failed.");
    if (response.ok) {
      setReceiveQty({});
      router.refresh();
    }
  }

  return <>
    <section className="detail-card detail-section">
      <h2>Request Stock Transfer</h2>
      <p className="muted">The destination branch requests stock. Source stock is only reserved after approval and only deducted on dispatch.</p>
      <form className="catalog-form" onSubmit={createTransfer}>
        <label>Transfer number<input name="transferNumber" required /></label>
        <label>Source branch<select required value={sourceBranchId} onChange={event => {
          setSourceBranchId(event.target.value);
          setLines([{ lotId: "", requestedQty: "" }]);
        }}><option value="">Select source…</option>{branches.filter(branch => branch.id !== destinationBranchId).map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label>Destination branch<select required value={destinationBranchId} onChange={event => setDestinationBranchId(event.target.value)}><option value="">Select destination…</option>{branches.filter(branch => branch.id !== sourceBranchId).map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label className="form-span">Notes<textarea name="notes" rows={2} /></label>

        <div className="form-span">
          <h3>Lots & Quantities</h3>
          <div className="reflex-list">
            {lines.map((line, index) => {
              const selected = lotById.get(line.lotId);
              return <div className="reflex-card" key={index}>
                <div className="catalog-form" style={{ flex: 1 }}>
                  <label>Lot<select value={line.lotId} required disabled={!sourceBranchId} onChange={event => updateLine(index, "lotId", event.target.value)}>
                    <option value="">Select lot…</option>
                    {sourceLots.map(stock => <option key={stock.lotId} value={stock.lotId}>{stock.itemCode} — {stock.lotNumber} · Available {stock.availableQty} {stock.stockUnit}{stock.expiryDate ? " · Exp " + stock.expiryDate : ""}</option>)}
                  </select></label>
                  <label>Requested quantity<input type="number" min="0.0001" step="0.0001" value={line.requestedQty} required onChange={event => updateLine(index, "requestedQty", event.target.value)} /></label>
                  {selected && <small className="muted">{selected.itemName} · Available {selected.availableQty} {selected.stockUnit}</small>}
                </div>
                {lines.length > 1 && <button type="button" className="secondary-button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}>Remove</button>}
              </div>;
            })}
          </div>
          <button type="button" className="secondary-button" disabled={!sourceBranchId} onClick={() => setLines(current => [...current, { lotId: "", requestedQty: "" }])}>Add Lot</button>
        </div>

        <button className="primary-button form-span" disabled={busy !== "" || !sourceBranchId || !destinationBranchId}>{busy === "create" ? "Saving…" : "Create Transfer Request"}</button>
      </form>
      {message && <div className="form-success">{message}</div>}
    </section>

    <section className="transfer-manifest-list detail-section">
      {transfers.length === 0 ? <article className="detail-card"><p className="empty-state">No inventory transfers found.</p></article> : transfers.map(transfer => <article className="detail-card transfer-manifest-card" key={transfer.id}>
        <div className="specimen-card-head">
          <div>
            <span className="eyebrow">{transfer.status}</span>
            <h3>{transfer.transferNumber}</h3>
            <p className="muted">{transfer.sourceBranchName} → {transfer.destinationBranchName}</p>
          </div>
          <div className="result-actions">
            {transfer.status === "DRAFT" && transfer.canSourceAct && <button type="button" className="secondary-button" disabled={busy !== ""} onClick={() => void simpleAction(transfer.id, "approve")}>Approve & Reserve</button>}
            {transfer.status === "APPROVED" && transfer.canSourceAct && <button type="button" className="primary-button" disabled={busy !== ""} onClick={() => void simpleAction(transfer.id, "dispatch")}>Dispatch</button>}
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
                <small>Lot {line.lotNumber}</small>
                <small>Requested {line.requestedQty} · Approved {line.approvedQty || "—"} · Dispatched {line.dispatchedQty || "—"} · Received {line.receivedQty || "0"} · Discrepancy {line.discrepancyQty || "—"}</small>
              </span>
              {["DISPATCHED","PARTIALLY_RECEIVED"].includes(transfer.status) && transfer.canDestinationAct && <input
                type="number"
                min="0"
                max={remaining}
                step="0.0001"
                value={receiveQty[line.id] ?? remaining.toString()}
                onChange={event => setReceiveQty(current => ({ ...current, [line.id]: event.target.value }))}
                aria-label={`Receive quantity for ${line.itemCode}`}
              />}
            </div>;
          })}
        </div>

        {["DISPATCHED","PARTIALLY_RECEIVED"].includes(transfer.status) && transfer.canDestinationAct && <div className="result-actions">
          <button type="button" className="secondary-button" disabled={busy !== ""} onClick={() => void receive(transfer, false)}>Post Partial Receipt</button>
          <button type="button" className="primary-button" disabled={busy !== ""} onClick={() => void receive(transfer, true)}>Finalize Receipt</button>
        </div>}
      </article>)}
    </section>
  </>;
}
