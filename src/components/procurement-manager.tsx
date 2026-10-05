"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Item = { id: string; code: string; nameEn: string; stockUnit: string };
type Branch = { id: string; code: string; nameEn: string };
type Supplier = { id: string; code: string; nameEn: string };
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
}: {
  items: Item[];
  branches: Branch[];
  suppliers: Supplier[];
  approvedRequests: ApprovedRequest[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [requestLines, setRequestLines] = useState<RequestLine[]>([
    { itemId: "", requestedQty: "", estimatedUnitCost: "", currency: "AED", notes: "" },
  ]);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([
    { itemId: "", orderedQty: "", unitCost: "" },
  ]);
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const selectedRequest = useMemo(() => approvedRequests.find(request => request.id === selectedRequestId) || null, [approvedRequests, selectedRequestId]);

  async function submit(url: string, payload: unknown, key: string, success: string) {
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
    if (response.ok) router.refresh();
    return response.ok;
  }

  function setRequestLine(index: number, field: keyof RequestLine, value: string) {
    setRequestLines(current => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }
  function setOrderLine(index: number, field: keyof OrderLine, value: string) {
    setOrderLines(current => current.map((line, i) => i === index ? { ...line, [field]: value } : line));
  }

  async function createRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
    }, "request", "Purchase request created.");
    if (ok) {
      event.currentTarget.reset();
      setRequestLines([{ itemId: "", requestedQty: "", estimatedUnitCost: "", currency: "AED", notes: "" }]);
    }
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
    }, "order", "Purchase order created.");
    if (ok) {
      event.currentTarget.reset();
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
      <h2>Create Purchase Request</h2>
      <form className="catalog-form" onSubmit={createRequest}>
        <label>Branch<select name="branchId" required defaultValue=""><option value="">Select branch…</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label>Request number<input name="requestNumber" required /></label>
        <label className="form-span">Notes<textarea name="notes" rows={2} /></label>

        <div className="form-span">
          <h3>Requested Items</h3>
          <div className="reflex-list">
            {requestLines.map((line, index) => <div className="reflex-card" key={index}>
              <div className="catalog-form" style={{ flex: 1 }}>
                <label>Item<select value={line.itemId} required onChange={event => setRequestLine(index, "itemId", event.target.value)}><option value="">Select item…</option>{items.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
                <label>Quantity<input type="number" min="0.0001" step="0.0001" value={line.requestedQty} required onChange={event => setRequestLine(index, "requestedQty", event.target.value)} /></label>
                <label>Estimated unit cost<input type="number" min="0.0001" step="0.0001" value={line.estimatedUnitCost} onChange={event => setRequestLine(index, "estimatedUnitCost", event.target.value)} /></label>
                <label>Currency<input maxLength={3} value={line.currency} onChange={event => setRequestLine(index, "currency", event.target.value.toUpperCase())} /></label>
                <label className="form-span">Line note<input value={line.notes} onChange={event => setRequestLine(index, "notes", event.target.value)} /></label>
              </div>
              {requestLines.length > 1 && <button type="button" className="secondary-button" onClick={() => setRequestLines(current => current.filter((_, i) => i !== index))}>Remove</button>}
            </div>)}
          </div>
          <button type="button" className="secondary-button" onClick={() => setRequestLines(current => [...current, { itemId: "", requestedQty: "", estimatedUnitCost: "", currency: "AED", notes: "" }])}>Add Item</button>
        </div>

        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "request" ? "Saving…" : "Create Purchase Request"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Create Purchase Order</h2>
      <form className="catalog-form" onSubmit={createOrder}>
        <label className="form-span">Approved request (optional)<select value={selectedRequestId} onChange={event => chooseApprovedRequest(event.target.value)}>
          <option value="">Standalone PO</option>
          {approvedRequests.map(request => <option key={request.id} value={request.id}>{request.requestNumber}</option>)}
        </select></label>
        {!selectedRequest && <label>Branch<select name="branchId" required defaultValue=""><option value="">Select branch…</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>}
        {selectedRequest && <div><strong>Branch</strong><span>{branches.find(branch => branch.id === selectedRequest.branchId)?.nameEn || selectedRequest.branchId}</span></div>}
        <label>Supplier<select name="supplierId" required defaultValue=""><option value="">Select supplier…</option>{suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.code} — {supplier.nameEn}</option>)}</select></label>
        <label>PO number<input name="poNumber" required /></label>
        <label>Currency<input name="currency" maxLength={3} defaultValue="AED" required /></label>
        <label>Supplier reference<input name="supplierReference" /></label>
        <label>Expected date<input name="expectedAt" type="date" /></label>
        <label className="form-span">Notes<textarea name="notes" rows={2} /></label>

        <div className="form-span">
          <h3>Order Lines</h3>
          <div className="reflex-list">
            {orderLines.map((line, index) => <div className="reflex-card" key={index}>
              <div className="catalog-form" style={{ flex: 1 }}>
                <label>Item<select value={line.itemId} required disabled={Boolean(selectedRequest)} onChange={event => setOrderLine(index, "itemId", event.target.value)}><option value="">Select item…</option>{items.map(item => <option key={item.id} value={item.id}>{item.code} — {item.nameEn}</option>)}</select></label>
                <label>Quantity<input type="number" min="0.0001" step="0.0001" value={line.orderedQty} required onChange={event => setOrderLine(index, "orderedQty", event.target.value)} /></label>
                <label>Unit cost<input type="number" min="0.0001" step="0.0001" value={line.unitCost} required onChange={event => setOrderLine(index, "unitCost", event.target.value)} /></label>
              </div>
              {!selectedRequest && orderLines.length > 1 && <button type="button" className="secondary-button" onClick={() => setOrderLines(current => current.filter((_, i) => i !== index))}>Remove</button>}
            </div>)}
          </div>
          {!selectedRequest && <button type="button" className="secondary-button" onClick={() => setOrderLines(current => [...current, { itemId: "", orderedQty: "", unitCost: "" }])}>Add Item</button>}
        </div>

        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "order" ? "Saving…" : "Create Purchase Order"}</button>
      </form>
    </article>

    {message && <div className="form-success form-span">{message}</div>}
  </section>;
}
