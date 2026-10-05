"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type LinkedTest = { id: string; code: string; name: string };

export function AliquotActions({
  specimenId,
  status,
  kind,
  volumeUnit,
  remainingVolume,
  storageLocation,
  linkedTests,
  canAliquot,
  canUse,
}: {
  specimenId: string;
  status: string;
  kind: string;
  volumeUnit: string | null;
  remainingVolume: number | null;
  storageLocation: string | null;
  linkedTests: LinkedTest[];
  canAliquot: boolean;
  canUse: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"ALIQUOT" | "USE" | "STORAGE" | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const available = ["RECEIVED","IN_PROCESS"].includes(status);

  async function submitAliquot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setMessage("");
    const orderItemIds = form.getAll("orderItemIds").map(String);
    const response = await fetch(`/api/specimens/${specimenId}/aliquots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        volume: form.get("volume"),
        volumeUnit: form.get("volumeUnit"),
        storageLocation: form.get("storageLocation"),
        notes: form.get("notes"),
        orderItemIds,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.ok) {
      setMessage(`Aliquot created: ${body.aliquot.barcode}`);
      setMode(null); router.refresh();
    } else if (body.error === "insufficient_remaining_volume") {
      setMessage(`Insufficient remaining volume. Available: ${body.remaining} ${body.volumeUnit || ""}`);
    } else setMessage(body.error || "Aliquot creation failed.");
  }

  async function submitUsage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setMessage("");
    const response = await fetch(`/api/specimens/${specimenId}/usage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usageType: form.get("usageType"),
        volumeUsed: form.get("volumeUsed"),
        volumeUnit: form.get("volumeUnit"),
        orderItemId: form.get("orderItemId") || null,
        purpose: form.get("purpose"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.ok) { setMessage("Specimen usage recorded."); setMode(null); router.refresh(); }
    else if (body.error === "insufficient_remaining_volume") {
      setMessage(`Insufficient remaining volume. Available: ${body.remaining} ${body.volumeUnit || ""}`);
    } else setMessage(body.error || "Usage recording failed.");
  }

  async function submitStorage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setMessage("");
    const response = await fetch(`/api/specimens/${specimenId}/storage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storageLocation: form.get("storageLocation") }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy(false);
    if (response.ok) { setMessage("Aliquot storage location updated."); setMode(null); router.refresh(); }
    else setMessage(body.error || "Storage update failed.");
  }

  return <div className="aliquot-actions">
    <div className="specimen-action-buttons">
      {canAliquot && available && <button className="secondary-button" type="button" onClick={() => setMode("ALIQUOT")}>Create Aliquot</button>}
      {canUse && available && <button className="secondary-button" type="button" onClick={() => setMode("USE")}>Record Usage</button>}
      {canAliquot && kind === "ALIQUOT" && <button className="secondary-button" type="button" onClick={() => setMode("STORAGE")}>Storage</button>}
    </div>
    {remainingVolume !== null && <p className="muted aliquot-volume-note">Remaining tracked volume: <strong>{remainingVolume.toFixed(3)} {volumeUnit || ""}</strong></p>}
    {message && <p className="form-success">{message}</p>}

    {mode === "ALIQUOT" && <form className="catalog-form specimen-action-form" onSubmit={submitAliquot}>
      <label>Aliquot volume<input name="volume" type="number" min="0.001" step="0.001" required /></label>
      <label>Unit<input name="volumeUnit" defaultValue={volumeUnit || ""} required readOnly={Boolean(volumeUnit)} /></label>
      <label className="form-span">Storage / rack / freezer<input name="storageLocation" maxLength={255} placeholder="Freezer A · Rack 2 · Box 4" /></label>
      <fieldset className="form-span test-picker"><legend>Linked tests</legend>
        {linkedTests.map(test => <label className="check-row" key={test.id}><input type="checkbox" name="orderItemIds" value={test.id} defaultChecked /> {test.code} — {test.name}</label>)}
      </fieldset>
      <label className="form-span">Notes<textarea name="notes" rows={2} /></label>
      <div className="form-span specimen-form-actions"><button className="secondary-button" type="button" onClick={() => setMode(null)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Creating…" : "Create Aliquot"}</button></div>
    </form>}

    {mode === "USE" && <form className="catalog-form specimen-action-form" onSubmit={submitUsage}>
      <label>Usage type<select name="usageType" defaultValue="TESTING"><option value="TESTING">Testing</option><option value="SEND_OUT">Send-out</option><option value="RETENTION">Retention</option><option value="TRANSFER">Transfer / derivation</option><option value="OTHER">Other</option></select></label>
      <label>Linked test<select name="orderItemId" defaultValue=""><option value="">General specimen use</option>{linkedTests.map(test => <option key={test.id} value={test.id}>{test.code} — {test.name}</option>)}</select></label>
      <label>Volume used<input name="volumeUsed" type="number" min="0.001" step="0.001" /></label>
      <label>Unit<input name="volumeUnit" defaultValue={volumeUnit || ""} readOnly={Boolean(volumeUnit)} /></label>
      <label className="form-span">Purpose / note<textarea name="purpose" rows={2} required /></label>
      <div className="form-span specimen-form-actions"><button className="secondary-button" type="button" onClick={() => setMode(null)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Record Usage"}</button></div>
    </form>}

    {mode === "STORAGE" && <form className="catalog-form specimen-action-form" onSubmit={submitStorage}>
      <label className="form-span">Storage / rack / freezer<input name="storageLocation" defaultValue={storageLocation || ""} maxLength={255} /></label>
      <div className="form-span specimen-form-actions"><button className="secondary-button" type="button" onClick={() => setMode(null)}>Cancel</button><button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Update Storage"}</button></div>
    </form>}
  </div>;
}
