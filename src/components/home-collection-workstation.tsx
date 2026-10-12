"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Choice = { id: string; label: string };
type Specimen = {
  id: string;
  barcode: string;
  status: string;
  collectedHere: boolean;
  receivedHere: boolean;
  type: string;
};
type Invoice = { id: string; invoiceNumber: string; status: string;
  currency: string; total: string; paid: string; balance: string };
type OrderChoice = { id: string; label: string };
export function HomeCollectionWorkstation({
  visitId, status, orderId, collectorUserId, locale, isManager,
  canCollect, canReceive, collectors, availableOrders, specimens, invoices, accession,
}: {
  visitId: string;
  status: string;
  orderId: string | null;
  collectorUserId: string | null;
  locale: "ar" | "en";
  isManager: boolean;
  canCollect: boolean;
  canReceive: boolean;
  collectors: Choice[];
  availableOrders: OrderChoice[];
  specimens: Specimen[];
  invoices: Invoice[];
  accession: string | null;
}) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [selectedOrder, setSelectedOrder] = useState("");
  const [selectedCollector, setSelectedCollector] = useState(collectorUserId || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [departureAt, setDepartureAt] = useState("");
  const [transportNotes, setTransportNotes] = useState("");
  const physical = specimens.filter(s => s.type !== "ALIQUOT" && s.status !== "COLLECTION_FAILED");
  const collected = physical.filter(s => s.collectedHere && ["COLLECTED","RECEIVED","IN_PROCESS"].includes(s.status)).length;
  const received = physical.filter(s => s.receivedHere && ["RECEIVED","IN_PROCESS"].includes(s.status)).length;

  async function send(url: string, payload: Record<string, unknown>) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        const label: Record<string,[string,string]> = {
          home_order_link_required: ["Link a priced laboratory order first.", "اربط طلبًا مخبريًا مسعرًا أولًا."],
          home_issued_invoice_required: ["Issue the order invoice before home collection.", "أصدر فاتورة الطلب قبل السحب المنزلي."],
          home_specimen_collection_evidence_missing: ["Specimen has no matched successful home collection attempt.", "إحدى العينات لا تملك دليل سحب منزلي ناجحًا مطابقًا."],
          home_specimen_reception_evidence_missing: ["The laboratory must formally receive all specimens first.", "يجب تسجيل استلام جميع العينات رسميًا في المختبر أولًا."],
          home_order_patient_branch_mismatch: ["Order patient, organization or branch does not match.", "مريض الطلب أو المؤسسة أو الفرع غير مطابق."],
          home_visit_too_advanced_to_link: ["Link the order before collection/dispatch.", "اربط الطلب قبل بدء جمع العينات أو الإرسال."],
          home_order_already_linked_elsewhere: ["The accession is already linked to another home visit.", "هذا الطلب مرتبط بزيارة منزلية أخرى."],
        };
        const err = label[data.error || ""];
        setMessage(err ? tr(err[0],err[1]) :
          tr("Action rejected: ", "تم رفض العملية: ") + (data.error || "unknown_error"));
      } else {
        setMessage(tr("Saved. Current visit data refreshed.", "تم الحفظ وتحديث بيانات الزيارة."));
        router.refresh();
      }
    } catch {
      setMessage(tr("Connection failed. Review the visit before retrying.",
        "فشل الاتصال. راجع حالة الزيارة قبل إعادة المحاولة."));
    } finally { setBusy(false); }
  }

  async function transition(next: string) {
    if (!window.confirm(tr(
      "Apply this home collection status? Specimen/financial checks are enforced by the server.",
      "هل تريد تغيير حالة الزيارة؟ سيتحقق النظام من العينات والفاتورة قبل الموافقة.",
    ))) return;
    await send(`/api/home-collections/${visitId}`, {
      status: next,
      ...(next === "ASSIGNED" ? { assignedCollectorUserId: selectedCollector } : {}),
      ...(departureAt ? { scheduledDepartureAt: new Date(departureAt).toISOString() } : {}),
      transportNotes,
    });
  }

  return <div className="detail-grid">
    <article className="detail-card">
      <h2>{tr("LIS order & finance", "الطلب المخبري والفوترة")}</h2>
      {orderId ? <>
        <p><strong>{accession}</strong></p>
        <p className="muted">{tr("Linked accession is immutable for this visit.", "الطلب المرتبط ثابت ولا يجوز تبديله بعد الربط.")}</p>
        <p><Link className="secondary-link" href={`/orders/${orderId}`}>{tr("Open clinical order & invoice", "فتح الطلب المخبرى والفاتورة")}</Link></p>
        {invoices.length === 0 ? <p className="form-warning">{tr(
          "No invoice issued yet. Collection cannot start.", "لم تُصدر فاتورة بعد؛ لا يمكن بدء السحب.")}</p> :
          <div className="table-wrap"><table><thead><tr>
            <th>{tr("Invoice", "الفاتورة")}</th><th>{tr("Status", "الحالة")}</th>
            <th>{tr("Total", "الإجمالي")}</th><th>{tr("Paid", "المدفوع")}</th>
            <th>{tr("Balance", "الباقي")}</th>
          </tr></thead><tbody>{invoices.map(inv=><tr key={inv.id}>
            <td>{inv.invoiceNumber}</td><td>{inv.status}</td>
            <td>{inv.total} {inv.currency}</td><td>{inv.paid} {inv.currency}</td>
            <td>{inv.balance} {inv.currency}</td>
          </tr>)}</tbody></table></div>}
        <p className="muted">{tr(
          "Outstanding credit balances are shown but are not silently converted or treated as paid.",
          "تظهر الأرصدة المستحقة بعملتها الأصلية، ولا تُحوّل أو تُعتبر مدفوعة تلقائيًا.",
        )}</p>
      </> : isManager ? <>
        <p>{tr(
          "Select the already registered, priced accession for this exact patient and branch.",
          "اختر الطلب المخبري المسجل والمسعر للمريض والفرع نفسه.",
        )}</p>
        <select value={selectedOrder} onChange={e => setSelectedOrder(e.target.value)}>
          <option value="">{tr("Select an eligible LIS order", "اختر طلبًا مخبريًا مؤهلًا")}</option>
          {availableOrders.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <button className="primary-button" disabled={!selectedOrder || busy}
          onClick={() => void send(`/api/home-collections/${visitId}/order`,{orderId:selectedOrder})}>
          {tr("Link accession to visit", "ربط الطلب بالزيارة")}
        </button>
      </> : <p className="form-warning">{tr(
        "Reception must link the laboratory order first.", "يجب على الاستقبال ربط الطلب المخبري أولًا.",
      )}</p>}
    </article>
    <article className="detail-card">
      <h2>{tr("Home dispatch & collection", "إرسال وجمع العينات المنزلية")}</h2>
      <p>{tr("Visit status", "حالة الزيارة")}: <strong>{status}</strong></p>
      {isManager && status === "SCHEDULED" && <>
        <label>{tr("Authorized branch collector", "موظف السحب المخوّل بالفرع")}
          <select value={selectedCollector} onChange={e=>setSelectedCollector(e.target.value)}>
            <option value="">{tr("Select collector", "اختر المُجمّع")}</option>
            {collectors.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <button className="secondary-button" disabled={busy || !selectedCollector}
          onClick={() => void transition("ASSIGNED")}>{tr("Assign collector", "تعيين المُجمّع")}</button>
      </>}
      {isManager && ["SCHEDULED","ASSIGNED"].includes(status) && <label>
        {tr("Planned departure (optional)", "المغادرة المخططة (اختياري)")}
        <input type="datetime-local" value={departureAt} onChange={e=>setDepartureAt(e.target.value)} />
      </label>}
      {isManager && ["ASSIGNED","EN_ROUTE","ARRIVED","COLLECTING","COLLECTED"].includes(status) && <>
        <label>{tr("Transport / handoff notes", "ملاحظات النقل والتسليم")}
          <textarea rows={3} value={transportNotes} onChange={e=>setTransportNotes(e.target.value)}/>
        </label>
        {status === "ASSIGNED" && <button className="secondary-button" disabled={busy || !orderId}
          onClick={() => void transition("EN_ROUTE")}>{tr("Dispatch / en route", "المغادرة نحو المنزل")}</button>}
        {status === "EN_ROUTE" && <button className="secondary-button" disabled={busy}
          onClick={() => void transition("ARRIVED")}>{tr("Arrived at home", "وصل إلى المنزل")}</button>}
        {status === "ARRIVED" && <button className="secondary-button" disabled={busy || !orderId}
          onClick={() => void transition("COLLECTING")}>{tr("Start verified collection", "بدء السحب الموثق")}</button>}
        {status === "COLLECTING" && <button className="secondary-button" disabled={busy || !orderId}
          onClick={() => void transition("COLLECTED")}>{tr("Verify all specimens collected", "التحقق من سحب جميع العينات")}</button>}
        {status === "COLLECTED" && <button className="primary-button" disabled={busy || !orderId}
          onClick={() => void transition("DELIVERED")}>{tr("Reconcile laboratory reception & complete", "مطابقة الاستلام بالمختبر وإتمام الزيارة")}</button>}
      </>}
      <p className="muted">{tr(
        "A status button never records sample collection or receipt itself. Use barcode workflows below.",
        "تغيير حالة الزيارة لا يسجل سحب أو استلام عينة؛ استخدم خطوات الباركود أدناه.",
      )}</p>
      {message && <p role="status" className="form-warning">{message}</p>}
    </article>
    <article className="detail-card">
      <h2>{tr("Barcode custody reconciliation", "مطابقة سلسلة حيازة العينات بالباركود")}</h2>
      <p><strong>{collected}/{physical.length}</strong> {tr("verified collected", "عينات مسحوبة موثقة")}
        {" · "}<strong>{received}/{physical.length}</strong> {tr("accepted at branch", "عينات مستلمة في الفرع")}</p>
      {physical.length === 0 ? <p className="form-warning">{tr(
        "Link a finalized LIS order with specimen requirements.", "اربط طلبًا مخبريًا مكتمل متطلبات العينات.",
      )}</p> : <div className="table-wrap"><table><thead><tr>
        <th>{tr("Barcode", "الباركود")}</th><th>{tr("State", "الحالة")}</th>
        <th>{tr("Home proof", "إثبات السحب")}</th>
        <th>{tr("Lab proof", "إثبات الاستلام")}</th><th>{tr("Actions", "الإجراءات")}</th>
      </tr></thead><tbody>{physical.map(item=><tr key={item.id}>
        <td><strong>{item.barcode}</strong></td><td>{item.status}</td>
        <td>{item.collectedHere ? tr("Recorded", "موثّق") : tr("Missing", "ناقص")}</td>
        <td>{item.receivedHere ? tr("Accepted", "مستلمة") : tr("Pending", "بانتظار الاستلام")}</td>
        <td>
          {canCollect && status === "COLLECTING" && item.status === "PLANNED" &&
            <Link className="secondary-link" href={`/phlebotomy?specimen=${item.id}`}>
              {tr("Verify & collect", "تحقق واسحب")}
            </Link>}
          {canReceive && item.status === "COLLECTED" &&
            <Link className="secondary-link" href={`/specimens?q=${encodeURIComponent(item.barcode)}`}>
              {tr("Receive at lab", "استلام بالمختبر")}
            </Link>}
        </td>
      </tr>)}</tbody></table></div>}
    </article>
  </div>;
}
