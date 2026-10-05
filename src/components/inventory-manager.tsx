"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Category = { id: string; code: string; nameEn: string };
type Supplier = { id: string; code: string; nameEn: string };
type Item = { id: string; code: string; nameEn: string; stockUnit: string; itemType: string; lotTracking: boolean; expiryTracking: boolean };
type Branch = { id: string; code: string; nameEn: string };

type ReceiptLine = {
  itemId: string;
  lotNumber: string;
  expiryDate: string;
  quantity: string;
  unitCost: string;
  currency: string;
};

export function InventoryManager({
  categories,
  suppliers,
  items,
  branches,
  canManage,
  canReceive,
}: {
  categories: Category[];
  suppliers: Supplier[];
  items: Item[];
  branches: Branch[];
  canManage: boolean;
  canReceive: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([
    { itemId: "", lotNumber: "", expiryDate: "", quantity: "", unitCost: "", currency: "AED" },
  ]);

  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);

  async function submitJson(url: string, payload: unknown, key: string, success: string, form?: HTMLFormElement) {
    setBusy(key);
    setMessage("");
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? success : body.error || "Request failed.");
    if (response.ok) {
      form?.reset();
      router.refresh();
    }
    return { response, body };
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitJson("/api/inventory/categories", {
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
    }, "category", "Inventory category created.", event.currentTarget);
  }

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitJson("/api/inventory/suppliers", {
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
      phone: form.get("phone"),
      email: form.get("email"),
      taxNumber: form.get("taxNumber"),
    }, "supplier", "Supplier created.", event.currentTarget);
  }

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitJson("/api/inventory/items", {
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
      categoryId: form.get("categoryId"),
      itemType: form.get("itemType"),
      stockUnit: form.get("stockUnit"),
      minimumStockQty: form.get("minimumStockQty"),
      reorderQty: form.get("reorderQty"),
      storageConditions: form.get("storageConditions"),
      lotTracking: form.get("lotTracking") === "on",
      expiryTracking: form.get("expiryTracking") === "on",
    }, "item", "Inventory item created.", event.currentTarget);
  }

  async function createReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      branchId: form.get("branchId"),
      supplierId: form.get("supplierId"),
      receiptNumber: form.get("receiptNumber"),
      supplierReference: form.get("supplierReference"),
      receivedAt: form.get("receivedAt"),
      notes: form.get("notes"),
      items: receiptLines,
    };
    const { response, body } = await submitJson("/api/inventory/receipts", payload, "receipt", "Goods receipt draft created.");
    if (response.ok && body.receipt?.id) {
      const post = await fetch(`/api/inventory/receipts/${body.receipt.id}/post`, { method: "POST" });
      const postBody = await post.json().catch(() => ({}));
      setMessage(post.ok ? "Goods receipt posted and branch stock updated." : postBody.error || "Receipt created but could not be posted.");
      if (post.ok) {
        event.currentTarget.reset();
        setReceiptLines([{ itemId: "", lotNumber: "", expiryDate: "", quantity: "", unitCost: "", currency: "AED" }]);
        router.refresh();
      }
    }
  }

  function updateLine(index: number, field: keyof ReceiptLine, value: string) {
    setReceiptLines(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  }

  return <section className="detail-grid detail-section">
    {canManage && <article className="detail-card">
      <h2>Inventory Master Data</h2>
      <form className="catalog-form" onSubmit={createCategory}>
        <h3 className="form-span">Category</h3>
        <label>Code<input name="code" required /></label>
        <label>Name<input name="nameEn" required /></label>
        <label className="form-span" dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "category" ? "Saving…" : "Create Category"}</button>
      </form>

      <form className="catalog-form" onSubmit={createSupplier}>
        <h3 className="form-span">Supplier</h3>
        <label>Code<input name="code" required /></label>
        <label>Name<input name="nameEn" required /></label>
        <label>Phone<input name="phone" /></label>
        <label>Email<input name="email" type="email" /></label>
        <label>Tax number<input name="taxNumber" /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "supplier" ? "Saving…" : "Create Supplier"}</button>
      </form>

      <form className="catalog-form" onSubmit={createItem}>
        <h3 className="form-span">Inventory Item</h3>
        <label>Code<input name="code" required /></label>
        <label>Name<input name="nameEn" required /></label>
        <label>Category<select name="categoryId" defaultValue=""><option value="">Uncategorized</option>{categories.map(category => <option key={category.id} value={category.id}>{category.code} — {category.nameEn}</option>)}</select></label>
        <label>Type<select name="itemType" defaultValue="REAGENT">{["REAGENT","CONTROL","CALIBRATOR","KIT","TUBE","NEEDLE","CONSUMABLE","OTHER"].map(type => <option key={type} value={type}>{type}</option>)}</select></label>
        <label>Stock unit<input name="stockUnit" required placeholder="kit, box, mL, piece…" /></label>
        <label>Minimum stock<input name="minimumStockQty" type="number" min="0" step="0.0001" defaultValue="0" /></label>
        <label>Reorder quantity<input name="reorderQty" type="number" min="0" step="0.0001" /></label>
        <label className="form-span">Storage conditions<input name="storageConditions" /></label>
        <label className="check-line"><input name="lotTracking" type="checkbox" defaultChecked /> Lot tracking</label>
        <label className="check-line"><input name="expiryTracking" type="checkbox" defaultChecked /> Expiry tracking</label>
        <label className="form-span" dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "item" ? "Saving…" : "Create Item"}</button>
      </form>
    </article>}

    {canReceive && <article className="detail-card">
      <h2>Receive Supplier Stock</h2>
      <p className="muted">Creates and immediately posts one goods receipt. Posting is atomic and records lot, branch stock and stock movements.</p>
      <form className="catalog-form" onSubmit={createReceipt}>
        <label>Branch<select name="branchId" required defaultValue=""><option value="">Select branch…</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label>Supplier<select name="supplierId" required defaultValue=""><option value="">Select supplier…</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.nameEn}</option>)}</select></label>
        <label>Receipt number<input name="receiptNumber" required /></label>
        <label>Supplier reference<input name="supplierReference" /></label>
        <label>Received at<input name="receivedAt" type="datetime-local" /></label>
        <label className="form-span">Notes<textarea name="notes" rows={2} /></label>

        <div className="form-span">
          <h3>Receipt Lines</h3>
          <div className="reflex-list">
            {receiptLines.map((line, index) => {
              const selected = itemById.get(line.itemId);
              return <div className="reflex-card" key={index}>
                <div className="catalog-form" style={{ flex: 1 }}>
                  <label>Item<select value={line.itemId} required onChange={event => updateLine(index, "itemId", event.target.value)}>
                    <option value="">Select item…</option>
                    {items.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}
                  </select></label>
                  <label>Lot<input value={line.lotNumber} required={selected?.lotTracking !== false} onChange={event => updateLine(index, "lotNumber", event.target.value)} /></label>
                  <label>Expiry<input type="date" value={line.expiryDate} required={selected?.expiryTracking !== false} onChange={event => updateLine(index, "expiryDate", event.target.value)} /></label>
                  <label>Quantity<input type="number" min="0.0001" step="0.0001" value={line.quantity} required onChange={event => updateLine(index, "quantity", event.target.value)} /></label>
                  <label>Unit cost<input type="number" min="0.0001" step="0.0001" value={line.unitCost} required onChange={event => updateLine(index, "unitCost", event.target.value)} /></label>
                  <label>Currency<input maxLength={3} value={line.currency} required onChange={event => updateLine(index, "currency", event.target.value.toUpperCase())} /></label>
                </div>
                {receiptLines.length > 1 && <button type="button" className="secondary-button" onClick={() => setReceiptLines(current => current.filter((_, i) => i !== index))}>Remove</button>}
              </div>;
            })}
          </div>
          <button type="button" className="secondary-button" onClick={() => setReceiptLines(current => [...current, { itemId: "", lotNumber: "", expiryDate: "", quantity: "", unitCost: "", currency: "AED" }])}>Add Line</button>
        </div>

        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "receipt" ? "Posting…" : "Receive & Post Stock"}</button>
      </form>
    </article>}

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
