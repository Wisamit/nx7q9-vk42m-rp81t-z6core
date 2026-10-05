"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type Candidate = {
  orderItemId: string;
  specimenId: string;
  performingBranchId: string;
  accession: string;
  patient: string;
  testCode: string;
  testName: string;
  barcode: string;
  branchName: string;
};

export function MicrobiologyManager({ candidates }: { candidates: Candidate[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  async function createCase(candidate: Candidate) {
    setBusy(candidate.orderItemId + candidate.specimenId);
    setMessage("");
    const response = await fetch("/api/microbiology/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderItemId: candidate.orderItemId,
        specimenId: candidate.specimenId,
        performingBranchId: candidate.performingBranchId,
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    if (response.ok && body.case?.id) {
      router.push(`/microbiology/${body.case.id}`);
    } else {
      setMessage(body.error || "Could not create microbiology case.");
    }
  }

  async function createMaster(event: FormEvent<HTMLFormElement>, type: "ORGANISM" | "ANTIBIOTIC") {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(type);
    setMessage("");
    const response = await fetch("/api/microbiology/master-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        code: form.get("code"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        category: form.get("category"),
        drugClass: form.get("drugClass"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setBusy("");
    setMessage(response.ok ? `${type === "ORGANISM" ? "Organism" : "Antibiotic"} created.` : body.error || "Could not create master data.");
    if (response.ok) {
      event.currentTarget.reset();
      router.refresh();
    }
  }

  return <>
    <section className="detail-grid detail-section">
      <article className="detail-card">
        <h2>Add Organism</h2>
        <form className="catalog-form" onSubmit={event => void createMaster(event, "ORGANISM")}>
          <label>Code<input name="code" required /></label>
          <label>English name<input name="nameEn" required /></label>
          <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
          <label>Category<input name="category" placeholder="Bacteria / fungus / other" /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "ORGANISM" ? "Saving…" : "Add Organism"}</button>
        </form>
      </article>
      <article className="detail-card">
        <h2>Add Antibiotic</h2>
        <form className="catalog-form" onSubmit={event => void createMaster(event, "ANTIBIOTIC")}>
          <label>Code<input name="code" required /></label>
          <label>English name<input name="nameEn" required /></label>
          <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
          <label>Drug class<input name="drugClass" /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "ANTIBIOTIC" ? "Saving…" : "Add Antibiotic"}</button>
        </form>
      </article>
    </section>

    {message && <p className="form-success">{message}</p>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>Ready Microbiology Work</h2><span>{candidates.length} ready specimen(s)</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>Accession / Patient</th><th>Test</th><th>Specimen</th><th>Branch</th><th>Action</th></tr></thead>
        <tbody>{candidates.length === 0 ? <tr><td colSpan={5} className="empty-state">No received microbiology specimens are waiting for case creation.</td></tr> : candidates.map(candidate => {
          const key = candidate.orderItemId + candidate.specimenId;
          return <tr key={key}>
            <td><strong>{candidate.accession}</strong><br/><small>{candidate.patient}</small></td>
            <td><strong>{candidate.testCode}</strong><br/><small>{candidate.testName}</small></td>
            <td>{candidate.barcode}</td>
            <td>{candidate.branchName}</td>
            <td><button className="secondary-button" disabled={busy !== ""} onClick={() => void createCase(candidate)}>{busy === key ? "Opening…" : "Start Case"}</button></td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>
  </>;
}
