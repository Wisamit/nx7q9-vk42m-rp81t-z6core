"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { AttachmentManager } from "@/components/attachment-manager";

type Laboratory = { id: string; code: string; nameEn: string };
type Candidate = {
  key: string;
  orderItemId: string;
  specimenId: string;
  branchId: string;
  label: string;
};
type AttachmentItem = {
  id: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: string;
};
type Referral = {
  id: string;
  status: string;
  branchCode: string;
  accessionNumber: string;
  patientNumber: string;
  patientName: string;
  testCode: string;
  testName: string;
  specimenBarcode: string | null;
  laboratoryCode: string;
  laboratoryName: string;
  externalAccession: string | null;
  costAmount: string | null;
  costCurrency: string | null;
  expectedResultAt: string | null;
  courier: string | null;
  trackingReference: string | null;
  dispatchedAt: string | null;
  resultReceivedAt: string | null;
  externalResultText: string | null;
  verifiedAt: string | null;
  events: Array<{ id: string; fromStatus: string | null; toStatus: string; occurredAt: string; actor: string; note: string | null }>;
  attachments: AttachmentItem[];
};

export function SendOutManager({
  laboratories,
  candidates,
  referrals,
  canManage,
  canVerify,
  canUploadAttachments,
}: {
  laboratories: Laboratory[];
  candidates: Candidate[];
  referrals: Referral[];
  canManage: boolean;
  canVerify: boolean;
  canUploadAttachments: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [candidateKey, setCandidateKey] = useState("");
  const [resultTexts, setResultTexts] = useState<Record<string, string>>({});

  async function createLab(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("lab"); setMessage("");
    const response = await fetch("/api/send-outs/laboratories", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(form.entries())),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage("External laboratory created.");
      event.currentTarget.reset();
      router.refresh();
    } else setMessage(body.error || "Could not create external laboratory.");
    setBusy("");
  }

  async function createReferral(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = candidates.find(item => item.key === candidateKey);
    if (!candidate) { setMessage("Select an order item/specimen."); return; }
    const form = new FormData(event.currentTarget);
    setBusy("referral"); setMessage("");
    const response = await fetch("/api/send-outs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchId: candidate.branchId,
        orderItemId: candidate.orderItemId,
        specimenId: candidate.specimenId,
        externalLaboratoryId: form.get("externalLaboratoryId"),
        externalAccession: form.get("externalAccession"),
        costAmount: form.get("costAmount"),
        costCurrency: form.get("costCurrency"),
        expectedResultAt: form.get("expectedResultAt"),
        note: form.get("note"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage("Send-out referral created.");
      setCandidateKey("");
      event.currentTarget.reset();
      router.refresh();
    } else setMessage(body.error || "Could not create send-out referral.");
    setBusy("");
  }

  async function act(referralId: string, action: string, payload: Record<string, unknown> = {}) {
    setBusy(referralId + action); setMessage("");
    const response = await fetch(`/api/send-outs/${referralId}/actions`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage("Send-out updated.");
      router.refresh();
    } else setMessage(body.error || "Send-out action failed.");
    setBusy("");
  }

  return <div className="sendout-workspace">
    {canManage && <section className="detail-grid">
      <article className="detail-card">
        <h2>External Laboratory</h2>
        <form className="catalog-form" onSubmit={createLab}>
          <label>Code<input name="code" required /></label>
          <label>Name<input name="nameEn" required /></label>
          <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
          <label>Phone<input name="phone" /></label>
          <label>Email<input name="email" type="email" /></label>
          <label className="form-span">Address<textarea name="address" rows={2} /></label>
          <button className="secondary-button form-span" disabled={busy === "lab"}>{busy === "lab" ? "Saving…" : "Add External Laboratory"}</button>
        </form>
      </article>

      <article className="detail-card">
        <h2>Create Send-out</h2>
        <form className="catalog-form" onSubmit={createReferral}>
          <label className="form-span">Ordered test / specimen<select value={candidateKey} onChange={event => setCandidateKey(event.target.value)} required>
            <option value="">Select…</option>
            {candidates.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </select></label>
          <label className="form-span">External laboratory<select name="externalLaboratoryId" required>
            <option value="">Select…</option>
            {laboratories.map(lab => <option key={lab.id} value={lab.id}>{lab.code} — {lab.nameEn}</option>)}
          </select></label>
          <label>External accession<input name="externalAccession" /></label>
          <label>Expected result<input name="expectedResultAt" type="datetime-local" /></label>
          <label>Cost<input name="costAmount" type="number" min="0" step="0.0001" /></label>
          <label>Currency<input name="costCurrency" maxLength={3} placeholder="AED" /></label>
          <label className="form-span">Note<input name="note" /></label>
          <button className="primary-button form-span" disabled={busy === "referral"}>{busy === "referral" ? "Creating…" : "Create Send-out Referral"}</button>
        </form>
      </article>
    </section>}

    {message && <p className="form-success">{message}</p>}

    <section className="sendout-list">
      {referrals.length === 0 ? <article className="detail-card"><p className="empty-state">No send-out referrals.</p></article> :
        referrals.map(referral => <article className="detail-card sendout-card" key={referral.id}>
          <div className="sendout-head">
            <div>
              <span className={"status-badge status-" + referral.status.toLowerCase().replaceAll("_","-")}>{referral.status}</span>
              <h2>{referral.testCode} — {referral.testName}</h2>
              <p className="muted">{referral.accessionNumber} · {referral.patientNumber} · {referral.patientName}</p>
            </div>
            <div className="sendout-lab"><small>Referral laboratory</small><strong>{referral.laboratoryCode} — {referral.laboratoryName}</strong></div>
          </div>

          <div className="specimen-metadata">
            <div><span>Branch</span><strong>{referral.branchCode}</strong></div>
            <div><span>Specimen</span><strong className="barcode-text">{referral.specimenBarcode || "—"}</strong></div>
            <div><span>External accession</span><strong>{referral.externalAccession || "—"}</strong></div>
            <div><span>Expected result</span><strong>{referral.expectedResultAt?.replace("T"," ").slice(0,16) || "—"}</strong></div>
            <div><span>Cost</span><strong>{referral.costAmount && referral.costCurrency ? referral.costAmount + " " + referral.costCurrency : "—"}</strong></div>
            <div><span>Dispatch</span><strong>{referral.dispatchedAt?.replace("T"," ").slice(0,16) || "—"}</strong></div>
          </div>

          <div className="sendout-actions">
            {canManage && referral.status === "CREATED" && <form onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void act(referral.id, "DISPATCH", {
                externalAccession: form.get("externalAccession"),
                courier: form.get("courier"),
                trackingReference: form.get("trackingReference"),
                note: form.get("note"),
              });
            }}>
              <input name="externalAccession" defaultValue={referral.externalAccession || ""} placeholder="External accession" />
              <input name="courier" placeholder="Courier" />
              <input name="trackingReference" placeholder="Tracking reference" />
              <input name="note" placeholder="Dispatch note" />
              <button className="primary-button" disabled={busy === referral.id + "DISPATCH"}>Dispatch</button>
            </form>}

            {canManage && referral.status === "DISPATCHED" && <form onSubmit={event => {
              event.preventDefault();
              void act(referral.id, "RECEIVE_RESULT", {
                externalResultText: resultTexts[referral.id] || "",
                note: new FormData(event.currentTarget).get("note"),
              });
            }}>
              <textarea rows={3} value={resultTexts[referral.id] ?? referral.externalResultText ?? ""} onChange={event => setResultTexts(current => ({...current,[referral.id]:event.target.value}))} placeholder="External result / interpretation (or upload report below)" />
              <input name="note" placeholder="Receipt note" />
              <button className="primary-button" disabled={busy === referral.id + "RECEIVE_RESULT"}>Record Result Received</button>
            </form>}

            {canVerify && referral.status === "RESULT_RECEIVED" && <button className="primary-button" onClick={() => void act(referral.id, "VERIFY")} disabled={busy === referral.id + "VERIFY"}>Verify External Result</button>}
            {canVerify && referral.status === "VERIFIED" && <button className="primary-button" onClick={() => void act(referral.id, "COMPLETE")} disabled={busy === referral.id + "COMPLETE"}>Complete Send-out</button>}
            {canManage && ["CREATED","DISPATCHED"].includes(referral.status) && <button className="secondary-button" onClick={() => {
              const note = prompt("Cancellation reason:");
              if (note) void act(referral.id, "CANCEL", { note });
            }}>Cancel</button>}
          </div>

          {referral.externalResultText && <div className="sendout-result"><strong>External result</strong><p>{referral.externalResultText}</p></div>}

          <div className="sendout-attachments">
            <h3>External report / attachments</h3>
            <AttachmentManager targetType="SEND_OUT_REFERRAL" targetId={referral.id} attachments={referral.attachments} canUpload={canUploadAttachments && canManage} />
          </div>

          <details className="specimen-history">
            <summary>Chain of custody / status history ({referral.events.length})</summary>
            <div className="summary-list">{referral.events.map(event => <div key={event.id}>
              <span>{event.occurredAt.replace("T"," ").slice(0,19)} · {event.actor}</span>
              <strong>{event.fromStatus || "NEW"} → {event.toStatus}{event.note ? " · " + event.note : ""}</strong>
            </div>)}</div>
          </details>
        </article>)
      }
    </section>
  </div>;
}
