"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string };
type Item = { id: string; code: string; nameEn: string; stockUnit: string };
type Lot = { branchId: string; itemId: string; lotId: string; lotNumber: string; expiryDate: string | null; onHand: string; reserved: string };

export function InventoryOperationsManager({
  branches,
  items,
  lots,
  canAdjust,
  canConsume,
}: {
  branches: Branch[];
  items: Item[];
  lots: Lot[];
  canAdjust: boolean;
  canConsume: boolean;
}) {
  const router = useRouter();
  const [adjustBranchId, setAdjustBranchId] = useState("");
  const [adjustItemId, setAdjustItemId] = useState("");
  const [consumeBranchId, setConsumeBranchId] = useState("");
  const [consumeItemId, setConsumeItemId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const adjustLots = useMemo(
    () => lots.filter(lot => lot.branchId === adjustBranchId && lot.itemId === adjustItemId),
    [lots, adjustBranchId, adjustItemId],
  );
  const consumeLots = useMemo(
    () => lots.filter(lot => lot.branchId === consumeBranchId && lot.itemId === consumeItemId && Number(lot.onHand) - Number(lot.reserved) > 0),
    [lots, consumeBranchId, consumeItemId],
  );

  async function submit(url: string, payload: unknown, key: string, success: string, form: HTMLFormElement) {
    setBusy(key);
    setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? success : body.error || "Action failed.");
    if (response.ok) {
      form.reset();
      router.refresh();
    }
  }

  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("/api/inventory/adjustments", {
      branchId: adjustBranchId,
      itemId: adjustItemId,
      lotId: form.get("lotId"),
      movementType: form.get("movementType"),
      quantity: form.get("quantity"),
      reason: form.get("reason"),
    }, "adjust", "Stock adjustment posted.", event.currentTarget);
  }

  async function consume(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submit("/api/inventory/consumption", {
      branchId: consumeBranchId,
      itemId: consumeItemId,
      lotId: form.get("lotId") || null,
      quantity: form.get("quantity"),
      referenceType: form.get("referenceType"),
      referenceId: form.get("referenceId"),
      reason: form.get("reason"),
    }, "consume", "Inventory consumption posted using FEFO allocation.", event.currentTarget);
  }

  return <section className="detail-grid detail-section">
    {canAdjust && <article className="detail-card">
      <h2>Controlled Stock Adjustment</h2>
      <p className="muted">Use only for documented physical-count corrections, returns to stock or disposal. Supplier receiving should use Goods Receipt instead.</p>
      <form className="catalog-form" onSubmit={adjust}>
        <label>Branch<select required value={adjustBranchId} onChange={event => { setAdjustBranchId(event.target.value); setAdjustItemId(""); }}><option value="">Select branch…</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label>Item<select required disabled={!adjustBranchId} value={adjustItemId} onChange={event => setAdjustItemId(event.target.value)}><option value="">Select item…</option>{items.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
        <label>Lot<select name="lotId" required disabled={!adjustItemId} defaultValue=""><option value="">Select lot…</option>{adjustLots.map(lot => <option key={lot.lotId} value={lot.lotId}>{lot.lotNumber} · On hand {lot.onHand}{lot.expiryDate ? " · Exp " + lot.expiryDate : ""}</option>)}</select></label>
        <label>Movement<select name="movementType" defaultValue="ADJUSTMENT_OUT">
          <option value="ADJUSTMENT_IN">Adjustment in</option>
          <option value="ADJUSTMENT_OUT">Adjustment out</option>
          <option value="DISPOSAL">Disposal</option>
        </select></label>
        <label>Quantity<input name="quantity" type="number" min="0.0001" step="0.0001" required /></label>
        <label className="form-span">Reason<input name="reason" required /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "adjust" ? "Posting…" : "Post Adjustment"}</button>
      </form>
    </article>}

    {canConsume && <article className="detail-card">
      <h2>Consume Inventory</h2>
      <p className="muted">Leave lot blank to allocate automatically by FEFO. Expired lots and reserved quantities are excluded.</p>
      <form className="catalog-form" onSubmit={consume}>
        <label>Branch<select required value={consumeBranchId} onChange={event => { setConsumeBranchId(event.target.value); setConsumeItemId(""); }}><option value="">Select branch…</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label>Item<select required disabled={!consumeBranchId} value={consumeItemId} onChange={event => setConsumeItemId(event.target.value)}><option value="">Select item…</option>{items.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
        <label>Specific lot (optional)<select name="lotId" disabled={!consumeItemId} defaultValue=""><option value="">Automatic FEFO</option>{consumeLots.map(lot => <option key={lot.lotId} value={lot.lotId}>{lot.lotNumber} · Available {(Number(lot.onHand)-Number(lot.reserved)).toFixed(4)}{lot.expiryDate ? " · Exp " + lot.expiryDate : ""}</option>)}</select></label>
        <label>Quantity<input name="quantity" type="number" min="0.0001" step="0.0001" required /></label>
        <label>Reference type<input name="referenceType" placeholder="OrderItem, QCEvent, AnalyzerRun…" /></label>
        <label>Reference ID<input name="referenceId" maxLength={36} /></label>
        <label className="form-span">Reason / context<input name="reason" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "consume" ? "Posting…" : "Post Consumption"}</button>
      </form>
    </article>}

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
