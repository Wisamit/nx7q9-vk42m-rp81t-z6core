"use client";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Item = { id: string; code: string; nameEn: string; nameAr?: string | null; stockUnit: string };
type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Supplier = { id: string; code: string; nameEn: string; nameAr?: string | null };
type ApprovedRequest = {
  id: string;
  requestNumber: string;
  branchId: string;
  items: Array<{ itemId: string; requestedQty: string }>;
};

type RequestLine = { itemId: string; requestedQty: string; estimatedUnitCost: string; currency: string; notes: string };
type OrderLine = { itemId: string; orderedQty: string; unitCost: string };

export function ProcurementManager({
  items,
  branches,
  suppliers,
  approvedRequests,
  canManage,
  locale,
}: {
  items: Item[];
  branches: Branch[];
  suppliers: Supplier[];
  approvedRequests: ApprovedRequest[];
  canManage: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const submitting = useRef(false);
  const [isError, setIsError] = useState(false);
  const [message, setMessage] = useState("");
  const [uiEditor, setUiEditor] = useState("");
  const [requestLines, setRequestLines] = useState<RequestLine[]>([
    { itemId: "", requestedQty: "", estimatedUnitCost: "", currency: "AED", notes: "" },
  ]);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([
    { itemId: "", orderedQty: "", unitCost: "" },
  ]);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const selectedRequest = useMemo(() => approvedRequests.find(request => request.id === selectedRequestId) || null, [approvedRequests, selectedRequestId]);

  async function submit(url: string, payload: unknown, key: string, success: string) {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(key);
    setMessage("");
    setIsError(false);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await response.json().catch(() => ({}));
      setIsError(!response.ok);
      setMessage(response.ok ? success : tr("Request failed.", "فشل الطلب."));
      if (response.ok) router.refresh();
      return response.ok;
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Verify the purchase request or order number before creating another.",
        "انقطع الاتصال. تحقق من رقم طلب أو أمر الشراء قبل إنشاء سجل آخر.",
      ));
      return false;
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  function setRequestLine(index: number, field: keyof RequestLine, value: string) {
    setRequestLines(current => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }
  function setOrderLine(index: number, field: keyof OrderLine, value: string) {
    setOrderLines(current => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await submit("/api/inventory/purchase-requests", {
      branchId: form.get("branchId"),
      requestNumber: form.get("requestNumber"),
      notes: form.get("notes"),
      items: requestLines.map(line => ({
        itemId: line.itemId,
        requestedQty: line.requestedQty,
        estimatedUnitCost: line.estimatedUnitCost,
        currency: line.estimatedUnitCost ? line.currency : "",
        notes: line.notes,
      })),
    }, "request", tr("Purchase request created.", "تم إنشاء طلب الشراء."));
    if (ok) {
      formElement.reset();
      setRequestLines([{ itemId: "", requestedQty: "", estimatedUnitCost: "", currency: "AED", notes: "" }]);
    }
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await submit("/api/inventory/purchase-orders", {
      branchId: selectedRequest?.branchId || form.get("branchId"),
      supplierId: form.get("supplierId"),
      purchaseRequestId: selectedRequestId || null,
      poNumber: form.get("poNumber"),
      currency: form.get("currency"),
      supplierReference: form.get("supplierReference"),
      expectedAt: form.get("expectedAt"),
      notes: form.get("notes"),
      items: orderLines,
    }, "order", tr("Purchase order created.", "تم إنشاء أمر الشراء."));
    if (ok) {
      formElement.reset();
      setSelectedRequestId("");
      setOrderLines([{ itemId: "", orderedQty: "", unitCost: "" }]);
    }
  }

  function chooseApprovedRequest(value: string) {
    setSelectedRequestId(value);
    const request = approvedRequests.find(item => item.id === value);
    if (request) {
      setOrderLines(request.items.map(item => ({ itemId: item.itemId, orderedQty: item.requestedQty, unitCost: "" })));
    } else {
      setOrderLines([{ itemId: "", orderedQty: "", unitCost: "" }]);
    }
  }

  if (!canManage) return null;

  return <section className="detail-grid detail-section">
    <article className="detail-card">
      <h2>{tr("Create Purchase Request","إنشاء طلب شراء")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("request"); }}>
     {tr("Create Purchase Request", "إنشاء طلب شراء")}
   </button>
   <CrudModal open={uiEditor === "request"} onClose={() => {if (!submitting.current) setUiEditor("");}}
     size="compact" title={tr("Create Purchase Request", "إنشاء طلب شراء")}
     description={tr("Supplier procurement is branch scoped and requires the existing approval workflow.", "المشتريات محصورة ضمن الفرع وتخضع لمسار الاعتماد الحالي.")}>
     {uiEditor === "request" && <form className="catalog-form" onSubmit={createRequest}>
        <label>{tr("Branch","الفرع")}<select name="branchId" required defaultValue=""><option value="">{tr("Select branch…","اختر الفرع…")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}</select></label>
        <label>{tr("Request number","رقم الطلب")}<input name="requestNumber" required /></label>
        <label className="form-span">{tr("Notes","ملاحظات")}<textarea name="notes" rows={2} /></label>

        <div className="form-span">
          <h3>{tr("Requested Items","الأصناف المطلوبة")}</h3>
          <div className="reflex-list">
            {requestLines.map((line, index) => <div className="reflex-card" key={index}>
              <div className="catalog-form" style={{ flex: 1 }}>
                <label>{tr("Item","الصنف")}<select value={line.itemId} required onChange={event => setRequestLine(index, "itemId", event.target.value)}><option value="">{tr("Select item…","اختر الصنف…")}</option>{items.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}</select></label>
                <label>{tr("Quantity","الكمية")}<input type="number" min="0.0001" step="0.0001" value={line.requestedQty} required onChange={event => setRequestLine(index, "requestedQty", event.target.value)} /></label>
                <label>{tr("Estimated unit cost","تكلفة الوحدة التقديرية")}<input type="number" min="0.0001" step="0.0001" value={line.estimatedUnitCost} onChange={event => setRequestLine(index, "estimatedUnitCost", event.target.value)} /></label>
                <label>{tr("Currency","العملة")}<input maxLength={3} value={line.currency} onChange={event => setRequestLine(index, "currency", event.target.value.toUpperCase())} /></label>
                <label className="form-span">{tr("Line note","ملاحظة البند")}<input value={line.notes} onChange={event => setRequestLine(index, "notes", event.target.value)} /></label>
              </div>
              {requestLines.length > 1 && <button type="button" className="secondary-button" onClick={() => setRequestLines(current => current.filter((_, i) => i !== index))}>{tr("Remove","إزالة")}</button>}
            </div>)}
          </div>
          <button type="button" className="secondary-button" onClick={() => setRequestLines(current => [...current, { itemId: "", requestedQty: "", estimatedUnitCost: "", currency: "AED", notes: "" }])}>{tr("Add Item","إضافة صنف")}</button>
        </div>

        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "request" ? tr("Saving…","جارٍ الحفظ…") : tr("Create Purchase Request","إنشاء طلب الشراء")}</button>
      </form>}
     {uiEditor === "request" && message && <p className={isError ? "form-error" : "form-success"} role={isError ? "alert" : "status"}>{message}</p>}
   </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Create Purchase Order","إنشاء أمر شراء")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
     onClick={() => { setMessage(""); setUiEditor("order"); }}>
     {tr("Create Purchase Order", "إنشاء أمر شراء")}
   </button>
   <CrudModal open={uiEditor === "order"} onClose={() => {if (!submitting.current) setUiEditor("");}}
     size="compact" title={tr("Create Purchase Order", "إنشاء أمر شراء")}
     description={tr("Only authorized approved requests may become purchase orders.", "تتحول الطلبات المعتمدة فقط إلى أوامر شراء وفق الصلاحيات.")}>
     {uiEditor === "order" && <form className="catalog-form" onSubmit={createOrder}>
        <label className="form-span">{tr("Approved request (optional)","طلب معتمد (اختياري)")}<select value={selectedRequestId} onChange={event => chooseApprovedRequest(event.target.value)}>
          <option value="">{tr("Standalone PO","أمر شراء مستقل")}</option>
          {approvedRequests.map(request => <option key={request.id} value={request.id}>{request.requestNumber}</option>)}
        </select></label>
        {!selectedRequest && <label>{tr("Branch","الفرع")}<select name="branchId" required defaultValue=""><option value="">{tr("Select branch…","اختر الفرع…")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}</select></label>}
        {selectedRequest && <div><strong>{tr("Branch","الفرع")}</strong><span>{branches.find(branch => branch.id === selectedRequest.branchId) ? localizedName(branches.find(branch => branch.id === selectedRequest.branchId)!) : selectedRequest.branchId}</span></div>}
        <label>{tr("Supplier","المورد")}<select name="supplierId" required defaultValue=""><option value="">{tr("Select supplier…","اختر المورد…")}</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.code} — {localizedName(supplier)}</option>)}</select></label>
        <label>{tr("PO number","رقم أمر الشراء")}<input name="poNumber" required /></label>
        <label>{tr("Currency","العملة")}<input name="currency" maxLength={3} defaultValue="AED" required /></label>
        <label>{tr("Supplier reference","مرجع المورد")}<input name="supplierReference" /></label>
        <label>{tr("Expected date","التاريخ المتوقع")}<input name="expectedAt" type="date" /></label>
        <label className="form-span">{tr("Notes","ملاحظات")}<textarea name="notes" rows={2} /></label>

        <div className="form-span">
          <h3>{tr("Order Lines","بنود أمر الشراء")}</h3>
          <div className="reflex-list">
            {orderLines.map((line, index) => <div className="reflex-card" key={index}>
              <div className="catalog-form" style={{ flex: 1 }}>
                <label>{tr("Item","الصنف")}<select value={line.itemId} required disabled={Boolean(selectedRequest)} onChange={event => setOrderLine(index, "itemId", event.target.value)}><option value="">{tr("Select item…","اختر الصنف…")}</option>{items.map(item => <option key={item.id} value={item.id}>{item.code} — {localizedName(item)}</option>)}</select></label>
                <label>{tr("Quantity","الكمية")}<input type="number" min="0.0001" step="0.0001" value={line.orderedQty} required onChange={event => setOrderLine(index, "orderedQty", event.target.value)} /></label>
                <label>{tr("Unit cost","تكلفة الوحدة")}<input type="number" min="0.0001" step="0.0001" value={line.unitCost} required onChange={event => setOrderLine(index, "unitCost", event.target.value)} /></label>
              </div>
              {!selectedRequest && orderLines.length > 1 && <button type="button" className="secondary-button" onClick={() => setOrderLines(current => current.filter((_, i) => i !== index))}>{tr("Remove","إزالة")}</button>}
            </div>)}
          </div>
          {!selectedRequest && <button type="button" className="secondary-button" onClick={() => setOrderLines(current => [...current, { itemId: "", orderedQty: "", unitCost: "" }])}>{tr("Add Item","إضافة صنف")}</button>}
        </div>

        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "order" ? tr("Saving…","جارٍ الحفظ…") : tr("Create Purchase Order","إنشاء أمر الشراء")}</button>
      </form>}
     {uiEditor === "order" && message && <p className={isError ? "form-error" : "form-success"} role={isError ? "alert" : "status"}>{message}</p>}
   </CrudModal>
    </article>

    {message && <div className={(isError ? "form-error" : "form-success") + " form-span"} role={isError ? "alert" : "status"}>{message}</div>}
  </section>;
}
