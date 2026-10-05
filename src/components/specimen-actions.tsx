"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type BranchOption = { id: string; code: string; nameEn: string };

export function SpecimenActions({
  specimenId,
  barcode,
  status,
  specimenTypeConfigured,
  branches,
  activeBranchId,
}: {
  specimenId: string;
  barcode: string;
  status: string;
  specimenTypeConfigured: boolean;
  branches: BranchOption[];
  activeBranchId: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"COLLECT" | "RECEIVE" | "REJECT" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const response = await fetch(`/api/specimens/${specimenId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: mode,
        branchId: form.get("branchId"),
        volume: form.get("volume"),
        volumeUnit: form.get("volumeUnit"),
        notes: form.get("notes"),
        rejectionReasonCode: form.get("rejectionReasonCode"),
        rejectionReasonText: form.get("rejectionReasonText"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(mode === "REJECT"
        ? `Rejected. Recollection barcode created: ${body.replacementBarcode}`
        : `${barcode} updated successfully.`);
      setMode(null);
      router.refresh();
    } else {
      setMessage(body.error || "Specimen action failed.");
    }
    setBusy(false);
  }

  return <div className="specimen-actions">
    <div className="specimen-action-buttons">
      {status === "PLANNED" && <button className="primary-button" disabled={!specimenTypeConfigured} onClick={() => setMode("COLLECT")}>Collect</button>}
      {["COLLECTED","IN_TRANSIT"].includes(status) && <button className="primary-button" onClick={() => setMode("RECEIVE")}>Receive</button>}
      {["COLLECTED","RECEIVED"].includes(status) && <button className="danger-button" onClick={() => setMode("REJECT")}>Reject</button>}
    </div>

    {!specimenTypeConfigured && status === "PLANNED" && <p className="form-error">Collection blocked: specimen type is not configured for this test.</p>}
    {message && <p className="form-success">{message}</p>}

    {mode && <form className="catalog-form specimen-action-form" onSubmit={submit}>
      <label className="form-span">Branch
        <select name="branchId" required defaultValue={activeBranchId || ""}>
          <option value="">Select branch…</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
        </select>
      </label>

      {mode === "COLLECT" && <>
        <label>Volume<input name="volume" type="number" min="0" step="0.001" /></label>
        <label>Volume unit<input name="volumeUnit" maxLength={30} placeholder="mL" /></label>
        <label className="form-span">Collection notes<textarea name="notes" rows={2} /></label>
      </>}

      {mode === "REJECT" && <>
        <label>Reason code<select name="rejectionReasonCode" required defaultValue="">
          <option value="">Select reason…</option>
          <option value="HEMOLYZED">Hemolyzed</option>
          <option value="CLOTTED">Clotted</option>
          <option value="INSUFFICIENT_VOLUME">Insufficient volume</option>
          <option value="WRONG_CONTAINER">Wrong container</option>
          <option value="LEAKING">Leaking</option>
          <option value="MISLABELED">Mislabeled</option>
          <option value="DELAYED_TRANSPORT">Delayed transport</option>
          <option value="OTHER">Other</option>
        </select></label>
        <label className="form-span">Reason details<textarea name="rejectionReasonText" rows={2} required /></label>
      </>}

      <div className="form-span specimen-form-actions">
        <button className="secondary-button" type="button" onClick={() => setMode(null)}>Cancel</button>
        <button className={mode === "REJECT" ? "danger-button" : "primary-button"} disabled={busy}>{busy ? "Saving…" : mode}</button>
      </div>
    </form>}
  </div>;
}
