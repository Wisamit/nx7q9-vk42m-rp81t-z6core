"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Item = { id: string; code: string; nameEn: string; nameAr?: string | null; stockUnit: string };
type Lot = { branchId: string; itemId: string; lotId: string; lotNumber: string; expiryDate: string | null; onHand: string; reserved: string };

export function InventoryOperationsManager({
  branches,
  items,
  lots,
  canAdjust,
  canConsume,
  locale,
}: {
  branches: Branch[];
  items: Item[];
  lots: Lot[];
  canAdjust: boolean;
  canConsume: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [adjustBranchId, setAdjustBranchId] = useState("");
  const [adjustItemId, setAdjustItemId] = useState("");
  const [consumeBranchId, setConsumeBranchId] = useState("");
  const [consumeItemId, setConsumeItemId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

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
    setMessage(response.ok ? success : tr("Action failed.", "فشلت العملية."));
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
    }, "adjust", tr("Stock adjustment posted.", "تم ترحيل تسوية المخزون."), event.currentTarget);
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
    }, "consume", tr("Inventory consumption posted using FEFO allocation.", "تم ترحيل استهلاك المخزون باستخدام تخصيص FEFO."), event.currentTarget);
  }

  return <section className="detail-grid detail-section">
    {canAdjust && <article className="detail-card">
      <h2>{tr("Controlled Stock Adjustment","تسوية مخزون مضبوطة")}</h2>
      <p className="muted">{tr("Use only for documented physical-count corrections, returns to stock or disposal. Supplier receiving should use Goods Receipt instead.", "تُستخدم فقط لتصحيحات الجرد الفعلي الموثقة أو الإرجاع للمخزون أو الإتلاف. استلام المورد يجب أن يتم عبر Goods Receipt.")}</p>
      <form className="catalog-form" onSubmit={adjust}>
        <label>{tr("Branch","الفرع")}<select required value={adjustBranchId} onChange={event => { setAdjustBranchId(event.target.value); setAdjustItemId(""); }}><option value="">{tr("Select branch…","اختر الفرع…")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}</select></label>
        <label>{tr("Item","الصنف")}<select required disabled={!adjustBranchId} value={adjustItemId} onChange={event => setAdjustItemId(event.target.value)}><option value="">{tr("Select item…","اختر الصنف…")}</option>{items.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}</select></label>
        <label>{tr("Lot","التشغيلة")}<select name="lotId" required disabled={!adjustItemId} defaultValue=""><option value="">{tr("Select lot…","اختر التشغيلة…")}</option>{adjustLots.map(lot => <option key={lot.lotId} value={lot.lotId}>{lot.lotNumber} · {tr("On hand","المتاح")} {lot.onHand}{lot.expiryDate ? " · " + tr("Exp","انتهاء") + " " + lot.expiryDate : ""}</option>)}</select></label>
        <label>{tr("Movement","الحركة")}<select name="movementType" defaultValue="ADJUSTMENT_OUT">
          <option value="ADJUSTMENT_IN">{tr("Adjustment in","تسوية إضافة")}</option>
          <option value="ADJUSTMENT_OUT">{tr("Adjustment out","تسوية خصم")}</option>
          <option value="DISPOSAL">{tr("Disposal","إتلاف")}</option>
        </select></label>
        <label>{tr("Quantity","الكمية")}<input name="quantity" type="number" min="0.0001" step="0.0001" required /></label>
        <label className="form-span">{tr("Reason","السبب")}<input name="reason" required /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "adjust" ? tr("Posting…","جارٍ الترحيل…") : tr("Post Adjustment","ترحيل التسوية")}</button>
      </form>
    </article>}

    {canConsume && <article className="detail-card">
      <h2>{tr("Consume Inventory","استهلاك المخزون")}</h2>
      <p className="muted">{tr("Leave lot blank to allocate automatically by FEFO. Expired lots and reserved quantities are excluded.", "اترك التشغيلة فارغة ليتم التخصيص تلقائياً وفق FEFO. تُستبعد التشغيلات المنتهية والكميات المحجوزة.")}</p>
      <form className="catalog-form" onSubmit={consume}>
        <label>{tr("Branch","الفرع")}<select required value={consumeBranchId} onChange={event => { setConsumeBranchId(event.target.value); setConsumeItemId(""); }}><option value="">{tr("Select branch…","اختر الفرع…")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}</select></label>
        <label>{tr("Item","الصنف")}<select required disabled={!consumeBranchId} value={consumeItemId} onChange={event => setConsumeItemId(event.target.value)}><option value="">{tr("Select item…","اختر الصنف…")}</option>{items.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}</select></label>
        <label>{tr("Specific lot (optional)","تشغيلة محددة (اختياري)")}<select name="lotId" disabled={!consumeItemId} defaultValue=""><option value="">{tr("Automatic FEFO","FEFO تلقائي")}</option>{consumeLots.map(lot => <option key={lot.lotId} value={lot.lotId}>{lot.lotNumber} · {tr("Available","المتاح")} {(Number(lot.onHand)-Number(lot.reserved)).toFixed(4)}{lot.expiryDate ? " · " + tr("Exp","انتهاء") + " " + lot.expiryDate : ""}</option>)}</select></label>
        <label>{tr("Quantity","الكمية")}<input name="quantity" type="number" min="0.0001" step="0.0001" required /></label>
        <label>{tr("Reference type","نوع المرجع")}<input name="referenceType" placeholder="OrderItem, QCEvent, AnalyzerRun…" /></label>
        <label>{tr("Reference ID","معرّف المرجع")}<input name="referenceId" maxLength={36} /></label>
        <label className="form-span">{tr("Reason / context","السبب / السياق")}<input name="reason" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "consume" ? tr("Posting…","جارٍ الترحيل…") : tr("Post Consumption","ترحيل الاستهلاك")}</button>
      </form>
    </article>}

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
