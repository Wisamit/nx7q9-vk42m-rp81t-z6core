"use client";
import { SystemDateTimeField } from "@/components/system-date-time-field";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

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
  const inFlight = useRef(false);
  const receiptForm = useRef<HTMLFormElement | null>(null);
  const pendingReceipt = useRef<string | null>(null);
  const [pendingReceiptId, setPendingReceiptId] = useState("");
  const [receiptUncertain, setReceiptUncertain] = useState(false);
  const [isError, setIsError] = useState(false);
  const [message, setMessage] = useState("");
  const [uiEditor, setUiEditor] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const itemTypeLabel = (value: string) => ({ REAGENT: tr("Reagent","كاشف"), CONTROL: tr("Control","مادة ضبط"), CALIBRATOR: tr("Calibrator","مادة معايرة"), KIT: tr("Kit","طقم"), TUBE: tr("Tube","أنبوب"), NEEDLE: tr("Needle","إبرة"), CONSUMABLE: tr("Consumable","مستهلك"), OTHER: tr("Other","أخرى") }[value] || value);
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([
    { itemId: "", lotNumber: "", expiryDate: "", quantity: "", unitCost: "", currency: "AED" },
  ]);

  const itemById = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);

  async function submitJson(
    url: string, payload: unknown, key: string, success: string,
    form?: HTMLFormElement, refreshOnSuccess = true,
  ) {
    if (inFlight.current) return { ok: false, body: {}, uncertain: false };
    inFlight.current = true;
    setBusy(key);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({}));
      setIsError(!response.ok);
      setMessage(response.ok ? success : tr("Request failed.", "فشل الطلب."));
      if (response.ok) {
        form?.reset();
        if (refreshOnSuccess) router.refresh();
      }
      return { ok: response.ok, body, uncertain: false };
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Verify the record before attempting another creation.",
        "انقطع الاتصال. تحقق من السجل قبل محاولة إنشاء جديدة.",
      ));
      return { ok: false, body: {}, uncertain: true };
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await submitJson("/api/inventory/categories", {
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
    }, "category", tr("Inventory category created.", "تم إنشاء فئة المخزون."), formElement);
  }

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    await submitJson("/api/inventory/suppliers", {
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
      phone: form.get("phone"),
      email: form.get("email"),
      taxNumber: form.get("taxNumber"),
    }, "supplier", tr("Supplier created.", "تم إنشاء المورد."), formElement);
  }

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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
    }, "item", tr("Inventory item created.", "تم إنشاء صنف المخزون."), formElement);
  }

  async function postExistingReceipt(id: string) {
    if (inFlight.current || !pendingReceipt.current || id !== pendingReceipt.current) return;
    inFlight.current = true;
    setBusy("receipt");
    setIsError(false);
    setMessage("");
    try {
      const response = await fetch(`/api/inventory/receipts/${id}/post`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      // A second attempt can observe the already-posted status when the
      // original HTTP response was lost. Never create a second receipt.
      const alreadyPosted = body.error === "goods_receipt_not_draft" && body.status === "POSTED";
      if (!response.ok && !alreadyPosted) {
        setIsError(true);
        setMessage(tr(
          "Draft receipt could not be posted. Retry posting this same draft, not creating another receipt.",
          "تعذر ترحيل مسودة الاستلام. أعد ترحيل المسودة نفسها، ولا تنشئ استلاماً جديداً.",
        ));
        return;
      }
      pendingReceipt.current = null;
      setPendingReceiptId("");
      setReceiptUncertain(false);
      if (receiptForm.current?.isConnected) receiptForm.current.reset();
      setReceiptLines([{ itemId: "", lotNumber: "", expiryDate: "", quantity: "", unitCost: "", currency: "AED" }]);
      setMessage(tr(
        alreadyPosted ? "Existing receipt was already posted. Stock records refreshed." : "Goods receipt posted and branch stock updated.",
        alreadyPosted ? "كان الاستلام مرحّلاً مسبقاً. تم تحديث سجل المخزون." : "تم ترحيل استلام البضاعة وتحديث مخزون الفرع.",
      ));
      router.refresh();
    } catch {
      setIsError(true);
      setMessage(tr(
        "Posting result is uncertain. Review the receipt or retry POST on this same receipt ID only.",
        "نتيجة الترحيل غير مؤكدة. تحقق من الاستلام أو أعد ترحيل معرّف الاستلام نفسه فقط.",
      ));
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }

  async function createReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (receiptUncertain || pendingReceipt.current) {
      setIsError(true);
      setMessage(tr(
        "A previous receipt request needs reconciliation before any new receipt can be created.",
        "هناك طلب استلام سابق يحتاج إلى المطابقة قبل إنشاء استلام جديد.",
      ));
      return;
    }
    const formElement = event.currentTarget;
    receiptForm.current = formElement;
    const form = new FormData(formElement);
    const payload = {
      branchId: form.get("branchId"),
      supplierId: form.get("supplierId"),
      receiptNumber: form.get("receiptNumber"),
      supplierReference: form.get("supplierReference"),
      receivedAt: form.get("receivedAt"),
      notes: form.get("notes"),
      items: receiptLines,
    };
    const result = await submitJson(
      "/api/inventory/receipts", payload, "receipt",
      tr("Goods receipt draft created.", "تم إنشاء مسودة استلام البضاعة."),
      undefined, false,
    );
    if (result.uncertain) {
      // No response ID is available: a second create could duplicate receipt
      // business records. Require reconciliation or a fresh verified session.
      setReceiptUncertain(true);
      return;
    }
    if (!result.ok) return;
    const id = result.body?.receipt?.id;
    if (typeof id !== "string" || !id) {
      setReceiptUncertain(true);
      setIsError(true);
      setMessage(tr(
        "Receipt creation may have succeeded but no receipt ID was returned. Reconcile before retrying.",
        "قد يكون إنشاء الاستلام نجح لكن لم يُرجع معرّفاً. طابق السجل قبل إعادة المحاولة.",
      ));
      return;
    }
    pendingReceipt.current = id;
    setPendingReceiptId(id);
    await postExistingReceipt(id);
  }

  function updateLine(index: number, field: keyof ReceiptLine, value: string) {
    setReceiptLines(current => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  }

  return <section className="detail-grid detail-section">
    {canManage && <article className="detail-card">
      <h2>{tr("Inventory Master Data", "البيانات الأساسية للمخزون")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={() => { setMessage(""); setUiEditor("category"); }}>
    {tr("Create Inventory Category", "إنشاء فئة مخزون")}
  </button>
  <CrudModal open={uiEditor === "category"} onClose={() => { if (!busy) setUiEditor(""); }}
    size="compact"
    title={tr("Create Inventory Category", "إنشاء فئة مخزون")}
    description={tr("Adds organization master data; existing inventory movements remain unchanged.", "ينشئ بيانات مرجعية دون تغيير حركات المخزون السابقة.")}>
    {uiEditor === "category" && <form className="catalog-form" onSubmit={createCategory}>
        <h3 className="form-span">{tr("Category", "الفئة")}</h3>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label className="form-span">{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "category" ? tr("Saving…","جارٍ الحفظ…") : tr("Create Category","إنشاء الفئة")}</button>
      </form>}
    {uiEditor === "category" && message && <p className="form-warning" role="status">{message}</p>}
  </CrudModal>

      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={() => { setMessage(""); setUiEditor("supplier"); }}>
    {tr("Create Supplier", "إنشاء مورد")}
  </button>
  <CrudModal open={uiEditor === "supplier"} onClose={() => { if (!busy) setUiEditor(""); }}
    size="compact"
    title={tr("Create Supplier", "إنشاء مورد")}
    description={tr("New supplier records do not rewrite historical purchase or receipt data.", "لا تغيّر بيانات المورد الجديدة المشتريات أو المستندات السابقة.")}>
    {uiEditor === "supplier" && <form className="catalog-form" onSubmit={createSupplier}>
        <h3 className="form-span">{tr("Supplier", "المورد")}</h3>
        <label>{tr("Code", "الرمز")}<input name="code" required /></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Phone", "الهاتف")}<input name="phone" /></label>
        <label>{tr("Email", "البريد الإلكتروني")}<input name="email" type="email" /></label>
        <label>{tr("Tax number", "الرقم الضريبي")}<input name="taxNumber" /></label>
        <label>{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <button className="secondary-button form-span" disabled={busy !== ""}>{busy === "supplier" ? tr("Saving…","جارٍ الحفظ…") : tr("Create Supplier","إنشاء المورد")}</button>
      </form>}
    {uiEditor === "supplier" && message && <p className="form-warning" role="status">{message}</p>}
  </CrudModal>

      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={() => { setMessage(""); setUiEditor("item"); }}>
    {tr("Create Inventory Item", "إنشاء صنف مخزون")}
  </button>
  <CrudModal open={uiEditor === "item"} onClose={() => { if (!busy) setUiEditor(""); }}
    size="compact"
    title={tr("Create Inventory Item", "إنشاء صنف مخزون")}
    description={tr("Choose unit, lot tracking and expiration behavior before creating a new item.", "اختر الوحدة والتتبع وتاريخ الصلاحية قبل إنشاء الصنف.")}>
    {uiEditor === "item" && <form className="catalog-form" onSubmit={createItem}>
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
      </form>}
    {uiEditor === "item" && message && <p className="form-warning" role="status">{message}</p>}
  </CrudModal>
    </article>}

    {canReceive && <article className="detail-card">
      <h2>{tr("Receive Supplier Stock", "استلام مخزون من المورد")}</h2>
      <p className="muted">{tr("Creates and immediately posts one goods receipt. Posting is atomic and records lot, branch stock and stock movements.", "ينشئ مستند استلام بضاعة ويرحله فوراً كعملية ذرية تسجل التشغيلة ومخزون الفرع وحركات المخزون.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
    onClick={() => { setMessage(""); setUiEditor("receipt"); }}>
    {tr("Receive Supplier Stock", "استلام مخزون من المورد")}
  </button>
  <CrudModal open={uiEditor === "receipt"} onClose={() => { if (!busy) setUiEditor(""); }}
    size="compact"
    title={tr("Receive Supplier Stock", "استلام مخزون من المورد")}
    description={tr("Posting a goods receipt writes branch stock and lot movements. Review quantities, unit cost and currency.", "يُرحّل الاستلام الكميات والتشغيلات في الفرع. راجع الكمية والكلفة والعملة.")}>
    {uiEditor === "receipt" && <form className="catalog-form" onSubmit={createReceipt}>
        <label>{tr("Branch","الفرع")}<select name="branchId" required defaultValue=""><option value="">{tr("Select branch…","اختر الفرع…")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}</select></label>
        <label>{tr("Supplier","المورد")}<select name="supplierId" required defaultValue=""><option value="">{tr("Select supplier…","اختر المورد…")}</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.code} — {localizedName(supplier)}</option>)}</select></label>
        <label>{tr("Receipt number","رقم الاستلام")}<input name="receiptNumber" required /></label>
        <label>{tr("Supplier reference","مرجع المورد")}<input name="supplierReference" /></label>
        <label>{tr("Received at","وقت الاستلام")}<SystemDateTimeField name="receivedAt" /></label>
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

        <button className="primary-button form-span" disabled={busy !== "" || Boolean(pendingReceiptId) || receiptUncertain}>{busy === "receipt" ? tr("Posting…","جارٍ الترحيل…") : tr("Receive & Post Stock","استلام وترحيل المخزون")}</button>
      </form>}
    {uiEditor === "receipt" && pendingReceiptId && <div className="form-span">
      <p className="form-warning" role="status">{tr(
        "Existing receipt draft awaiting confirmation:",
        "مسودة استلام موجودة بانتظار تأكيد الترحيل:",
      )} <code dir="ltr">{pendingReceiptId}</code></p>
      <button type="button" className="secondary-button" disabled={Boolean(busy)}
        onClick={() => void postExistingReceipt(pendingReceiptId)}>
        {tr("Retry posting this existing receipt", "إعادة ترحيل مسودة الاستلام نفسها")}
      </button>
    </div>}
    {uiEditor === "receipt" && receiptUncertain && <p className="form-warning" role="alert">{tr(
      "Receipt creation status is uncertain. Reconcile by receipt number before another creation.",
      "حالة إنشاء الاستلام غير مؤكدة. طابق رقم الاستلام قبل إنشاء سجل جديد.",
    )}</p>}
    {uiEditor === "receipt" && message && <p className={isError ? "form-error" : "form-success"} role={isError ? "alert" : "status"}>{message}</p>}
  </CrudModal>
    </article>}

    {message && <div className={(isError ? "form-error" : "form-success") + " form-span"} role={isError ? "alert" : "status"}>{message}</div>}
  </section>;
}
