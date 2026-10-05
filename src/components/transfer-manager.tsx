"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type BranchOption = { id: string; code: string; nameEn: string };
type SpecimenOption = {
  id: string;
  barcode: string;
  status: string;
  currentBranchId: string | null;
  order: { accessionNumber: string; patient: { patientNumber: string; fullNameEn: string } };
  specimenType: { nameEn: string } | null;
};
type ManifestItem = {
  specimenId: string;
  barcodeSnapshot: string;
  status: string;
  specimen: {
    order: { accessionNumber: string; patient: { patientNumber: string; fullNameEn: string } };
    specimenType: { nameEn: string } | null;
  };
};
type Manifest = {
  id: string;
  manifestNumber: string;
  status: string;
  sourceBranch: BranchOption;
  destinationBranch: BranchOption;
  transportMode: string | null;
  courierName: string | null;
  packageCount: number | null;
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
  items: ManifestItem[];
};

export function TransferManager({
  branches,
  sourceBranches,
  specimens,
  manifests,
  activeBranchId,
}: {
  branches: BranchOption[];
  sourceBranches: BranchOption[];
  specimens: SpecimenOption[];
  manifests: Manifest[];
  activeBranchId: string | null;
}) {
  const router = useRouter();
  const [sourceBranchId, setSourceBranchId] = useState(activeBranchId || sourceBranches[0]?.id || "");
  const [destinationBranchId, setDestinationBranchId] = useState("");
  const [selectedSpecimens, setSelectedSpecimens] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [receiveBarcodes, setReceiveBarcodes] = useState<Record<string, string>>({});

  const eligibleSpecimens = useMemo(
    () => specimens.filter((specimen) => specimen.currentBranchId === sourceBranchId),
    [specimens, sourceBranchId],
  );

  async function createManifest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceBranchId || !destinationBranchId || selectedSpecimens.length === 0) {
      setMessage("Select source, destination and at least one specimen.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy("create"); setMessage("");

    const response = await fetch("/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceBranchId,
        destinationBranchId,
        specimenIds: selectedSpecimens,
        transportMode: form.get("transportMode"),
        courierName: form.get("courierName"),
        packageCount: form.get("packageCount"),
        notes: form.get("notes"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      setMessage(`Manifest created: ${body.manifest.manifestNumber}`);
      setSelectedSpecimens([]);
      setDestinationBranchId("");
      event.currentTarget.reset();
      router.refresh();
    } else {
      setMessage(body.error || "Could not create transfer manifest.");
    }
    setBusy("");
  }

  async function dispatch(manifestId: string) {
    if (!confirm("Dispatch this manifest? All included specimens will become IN_TRANSIT.")) return;
    setBusy(`dispatch:${manifestId}`); setMessage("");
    const response = await fetch(`/api/transfers/${manifestId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "DISPATCH" }),
    });
    const body = await response.json().catch(() => ({}));
    setMessage(response.ok ? "Manifest dispatched." : body.error || "Dispatch failed.");
    setBusy("");
    if (response.ok) router.refresh();
  }

  async function receiveItem(manifestId: string) {
    const barcode = receiveBarcodes[manifestId]?.trim();
    if (!barcode) { setMessage("Scan or enter a barcode."); return; }
    setBusy(`receive:${manifestId}`); setMessage("");
    const response = await fetch(`/api/transfers/${manifestId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "RECEIVE_ITEM", barcode }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`${barcode} received. ${body.remaining} item(s) remaining.`);
      setReceiveBarcodes((values) => ({ ...values, [manifestId]: "" }));
      router.refresh();
    } else {
      setMessage(body.error || "Receipt failed.");
    }
    setBusy("");
  }

  return <div className="transfer-layout">
    <section className="detail-card">
      <h2>Create Transfer Manifest</h2>
      <form className="catalog-form" onSubmit={createManifest}>
        <label>Source branch
          <select value={sourceBranchId} onChange={(e) => { setSourceBranchId(e.target.value); setSelectedSpecimens([]); }} required>
            <option value="">Select source…</option>
            {sourceBranches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
          </select>
        </label>
        <label>Destination branch
          <select value={destinationBranchId} onChange={(e) => setDestinationBranchId(e.target.value)} required>
            <option value="">Select destination…</option>
            {branches.filter(branch => branch.id !== sourceBranchId).map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
          </select>
        </label>
        <label>Transport mode<input name="transportMode" placeholder="Courier / internal transport / driver" /></label>
        <label>Courier / driver<input name="courierName" /></label>
        <label>Package count<input name="packageCount" type="number" min="1" max="9999" /></label>
        <label className="form-span">Notes<textarea name="notes" rows={2} /></label>

        <div className="form-span">
          <strong>Eligible specimens at source branch</strong>
          <div className="transfer-specimen-selector">
            {eligibleSpecimens.length === 0 ? <p className="muted">No collected or received specimens available for transfer.</p> :
              eligibleSpecimens.map(specimen => <label className="transfer-specimen-option" key={specimen.id}>
                <input
                  type="checkbox"
                  checked={selectedSpecimens.includes(specimen.id)}
                  onChange={(e) => setSelectedSpecimens(ids => e.target.checked ? [...ids, specimen.id] : ids.filter(id => id !== specimen.id))}
                />
                <span><strong>{specimen.barcode}</strong><small>{specimen.specimenType?.nameEn || "Specimen"} · {specimen.order.accessionNumber} · {specimen.order.patient.patientNumber} · {specimen.order.patient.fullNameEn}</small></span>
              </label>)
            }
          </div>
        </div>

        <button className="primary-button form-span" disabled={busy === "create"}>{busy === "create" ? "Creating…" : `Create Manifest (${selectedSpecimens.length})`}</button>
      </form>
      {message && <p className="form-success">{message}</p>}
    </section>

    <section className="transfer-manifest-list">
      {manifests.length === 0 ? <article className="detail-card"><p className="empty-state">No transfer manifests yet.</p></article> :
        manifests.map(manifest => {
          const received = manifest.items.filter(item => item.status === "RECEIVED").length;
          return <article className="detail-card transfer-manifest-card" key={manifest.id}>
            <div className="specimen-card-head">
              <div>
                <p className="eyebrow">{manifest.status}</p>
                <h2>{manifest.manifestNumber}</h2>
                <p className="muted">{manifest.sourceBranch.code} → {manifest.destinationBranch.code} · {received}/{manifest.items.length} received</p>
              </div>
              {manifest.status === "DRAFT" && <button className="primary-button" disabled={busy === `dispatch:${manifest.id}`} onClick={() => void dispatch(manifest.id)}>Dispatch</button>}
            </div>

            <div className="specimen-metadata">
              <div><span>Transport</span><strong>{manifest.transportMode || "—"}</strong></div>
              <div><span>Courier</span><strong>{manifest.courierName || "—"}</strong></div>
              <div><span>Packages</span><strong>{manifest.packageCount || "—"}</strong></div>
              <div><span>Dispatched</span><strong>{manifest.dispatchedAt ? manifest.dispatchedAt.replace("T"," ").slice(0,19) : "—"}</strong></div>
              <div><span>Received</span><strong>{manifest.receivedAt ? manifest.receivedAt.replace("T"," ").slice(0,19) : "—"}</strong></div>
            </div>

            <div className="transfer-items">
              {manifest.items.map(item => <div className="transfer-item-row" key={item.specimenId}>
                <span><strong>{item.barcodeSnapshot}</strong><small>{item.specimen.specimenType?.nameEn || "Specimen"} · {item.specimen.order.accessionNumber} · {item.specimen.order.patient.fullNameEn}</small></span>
                <strong>{item.status}</strong>
              </div>)}
            </div>

            {["DISPATCHED","PARTIALLY_RECEIVED"].includes(manifest.status) && <div className="transfer-receive-box">
              <input
                value={receiveBarcodes[manifest.id] || ""}
                onChange={(e) => setReceiveBarcodes(values => ({ ...values, [manifest.id]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void receiveItem(manifest.id); } }}
                placeholder="Scan specimen barcode to receive…"
              />
              <button className="primary-button" type="button" disabled={busy === `receive:${manifest.id}`} onClick={() => void receiveItem(manifest.id)}>Receive Item</button>
            </div>}
          </article>;
        })
      }
    </section>
  </div>;
}
