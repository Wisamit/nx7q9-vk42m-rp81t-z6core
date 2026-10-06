"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Category = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Supplier = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Item = { id: string; code: string; nameEn: string; nameAr?: string | null; stockUnit: string; itemType: string; lotTracking: boolean; expiryTracking: boolean };
type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };

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
  locale,
}: {
  categories: Category[];
  suppliers: Supplier[];
  items: Item[];
  branches: Branch[];
  canManage: boolean;
  canReceive: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const itemTypeLabel = (value: string) => ({ REAGENT: tr("Reagent","كاشف"), CONTROL: tr("Control","مادة ضبط"), CALIBRATOR: tr("Calibrator","مادة معايرة"), KIT: tr("Kit","طقم"), TUBE: tr("Tube","أنبوب"), NEEDLE: tr("Needle","إبرة"), CONSUMABLE: tr("Consumable","مستهلك"), OTHER: tr("Other","أخرى") }[value] || value);
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
    setMessage(response.ok ? success : tr("Request failed.", "فشل الطلب."));
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
    }, "category", tr("Inventory category created.", "تم إنشاء فئة المخزون."), event.currentTarget);
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
    }, "supplier", tr("Supplier created.", "تم إنشاء المورد."), event.currentTarget);
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
    }, "item", tr("Inventory item created.", "تم إنشاء صنف المخزون."), event.currentTarget);
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
    const { response, body } = await submitJson("/api/inventory/receipts", payload, "receipt", tr("Goods receipt draft created.", "تم إنشاء مسودة استلام البضاعة."));
    if (response.ok && body.receipt?.id) {
      const post = await fetch(`/api/inventory/receipts/${body.receipt.id}/post`, { method: "POST" });
      const postBody = await post.json().catch(() => ({}));
      setMessage(post.ok ? tr("Goods receipt posted and branch stock updated.", "تم ترحيل استلام البضاعة وتحديث مخزون الفرع.") : tr("Receipt created but could not be posted.", "تم إنشاء الاستلام لكن تعذر ترحيله."));
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
      <h2>{tr("Inventory Master Data", "البيانات الأساسية للمخزون")}</h2>
      <form className="catalog-form" onSubmit={createCategory}>
        <h3 className="form-span">{tr("Category", "الفئة")}</h3>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label className="form-span">{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "category" ? tr("Saving…","جارٍ الحفظ…") : tr("Create Category","إنشاء الفئة")}</button>
      </form>

      <form className="catalog-form" onSubmit={createSupplier}>
        <h3 className="form-span">{tr("Supplier", "المورد")}</h3>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Phone", "الهاتف")}<input name="phone" /></label>
        <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" /></label>
        <label>{tr("Tax number", "الرقم الضريبي")}<input name="taxNumber" /></label>
        <label>{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "supplier" ? tr("Saving…","جارٍ الحفظ…") : tr("Create Supplier","إنشاء المورد")}</button>
      </form>

      <form className="catalog-form" onSubmit={createItem}>
        <h3 className="form-span">{tr("Inventory Item", "صنف المخزون")}</h3>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Category", "الفئة")}<select name="categoryId" defaultValue=""><option value="">{tr("Uncategorized","بدون فئة")}</option>{categories.map(category => <option key={category.id} value={category.id}>{category.code} — {localizedName(category)}</option>)}</select></label>
        <label>{tr("Type", "النوع")}<select name="itemType" defaultValue="REAGENT">{["REAGENT","CONTROL","CALIBRATOR","KIT","TUBE","NEEDLE","CONSUMABLE","OTHER"].map(type => <option key={type} value={type}>{itemTypeLabel(type)}</option>)}</select></label>
        <label>{tr("Stock unit", "وحدة المخزون")}<input name="stockUnit" required placeholder={tr("kit, box, mL, piece…","طقم، علبة، mL، قطعة…")} /></label>
        <label>{tr("Minimum stock", "الحد الأدنى للمخزون")}<input name="minimumStockQty" type="number" min="0" step="0.0001" defaultValue="0" /></label>
        <label>{tr("Reorder quantity", "كمية إعادة الطلب")}<input name="reorderQty" type="number" min="0" step="0.0001" /></label>
        <label className="form-span">{tr("Storage conditions", "شروط التخزين")}<input name="storageConditions" /></label>
        <label className="check-line"><input name="lotTracking" type="checkbox" defaultChecked /> {tr("Lot tracking","تتبع التشغيلات")}</label>
        <label className="check-line"><input name="expiryTracking" type="checkbox" defaultChecked /> {tr("Expiry tracking","تتبع الصلاحية")}</label>
        <label className="form-span">{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "item" ? tr("Saving…","جارٍ الحفظ…") : tr("Create Item","إنشاء الصنف")}</button>
      </form>
    </article>}

    {canReceive && <article className="detail-card">
      <h2>{tr("Receive Supplier Stock", "استلام مخزون من المورد")}</h2>
      <p className="muted">{tr("Creates and immediately posts one goods receipt. Posting is atomic and records lot, branch stock and stock movements.", "ينشئ مستند استلام بضاعة ويرحله فوراً كعملية ذرية تسجل التشغيلة ومخزون الفرع وحركات المخزون.")}</p>
      <form className="catalog-form" onSubmit={createReceipt}>
        <label>{tr("Branch","الفرع")}<select name="branchId" required defaultValue=""><option value="">{tr("Select branch…","اختر الفرع…")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}</select></label>
        <label>{tr("Supplier","المورد")}<select name="supplierId" required defaultValue=""><option value="">{tr("Select supplier…","اختر المورد…")}</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.code} — {localizedName(supplier)}</option>)}</select></label>
        <label>{tr("Receipt number","رقم الاستلام")}<input name="receiptNumber" required /></label>
        <label>{tr("Supplier reference","مرجع المورد")}<input name="supplierReference" /></label>
        <label>{tr("Received at","وقت الاستلام")}<input name="receivedAt" type="datetime-local" /></label>
        <label className="form-span">{tr("Notes","ملاحظات")}<textarea name="notes" rows={2} /></label>

        <div className="form-span">
          <h3>{tr("Receipt Lines","بنود الاستلام")}</h3>
          <div className="reflex-list">
            {receiptLines.map((line, index) => {
              const selected = itemById.get(line.itemId);
              return <div className="reflex-card" key={index}>
                <div className="catalog-form" style={{ flex: 1 }}>
                  <label>{tr("Item","الصنف")}<select value={line.itemId} required onChange={event => updateLine(index, "itemId", event.target.value)}>
                    <option value="">{tr("Select item…","اختر الصنف…")}</option>
                    {items.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}
                  </select></label>
                  <label>{tr("Lot","التشغيلة")}<input value={line.lotNumber} required={selected?.lotTracking !== false} onChange={event => updateLine(index, "lotNumber", event.target.value)} /></label>
                  <label>{tr("Expiry","الانتهاء")}<input type="date" value={line.expiryDate} required={selected?.expiryTracking !== false} onChange={event => updateLine(index, "expiryDate", event.target.value)} /></label>
                  <label>{tr("Quantity","الكمية")}<input type="number" min="0.0001" step="0.0001" value={line.quantity} required onChange={event => updateLine(index, "quantity", event.target.value)} /></label>
                  <label>{tr("Unit cost","تكلفة الوحدة")}<input type="number" min="0.0001" step="0.0001" value={line.unitCost} required onChange={event => updateLine(index, "unitCost", event.target.value)} /></label>
                  <label>{tr("Currency","العملة")}<input maxLength={3} value={line.currency} required onChange={event => updateLine(index, "currency", event.target.value.toUpperCase())} /></label>
                </div>
                {receiptLines.length > 1 && <button type="button" className="secondary-button" onClick={() => setReceiptLines(current => current.filter((_, i) => i !== index))}>{tr("Remove","إزالة")}</button>}
              </div>;
            })}
          </div>
          <button type="button" className="secondary-button" onClick={() => setReceiptLines(current => [...current, { itemId: "", lotNumber: "", expiryDate: "", quantity: "", unitCost: "", currency: "AED" }])}>{tr("Add Line","إضافة بند")}</button>
        </div>

        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "receipt" ? tr("Posting…","جارٍ الترحيل…") : tr("Receive & Post Stock","استلام وترحيل المخزون")}</button>
      </form>
    </article>}

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
