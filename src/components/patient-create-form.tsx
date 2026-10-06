"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function PatientCreateForm({ onSuccess }: { onSuccess?: (message: string) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/patients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullNameEn: form.get("fullNameEn"),
        fullNameAr: form.get("fullNameAr"),
        dateOfBirth: form.get("dateOfBirth"),
        sexAtBirth: form.get("sexAtBirth"),
        phone: form.get("phone"),
        email: form.get("email"),
        nationalId: form.get("nationalId"),
        nationalityCode: form.get("nationalityCode"),
      }),
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok) {
      const success = `Patient created: ${body.patient.patientNumber}`;
      setMessage(success);
      event.currentTarget.reset();
      router.refresh();
      onSuccess?.(success);
    } else if (body.error === "possible_duplicate" || body.error === "identifier_already_used") {
      setMessage(`Potential duplicate found: ${body.patient?.patientNumber || ""} ${body.patient?.fullNameEn || ""}`);
    } else {
      setMessage(body.error || "Patient creation failed.");
    }
    setBusy(false);
  }

  return <form className="catalog-form" onSubmit={submit}>
    <label>Full name (English)<input name="fullNameEn" required maxLength={220} /></label>
    <label dir="rtl">الاسم الكامل بالعربية<input name="fullNameAr" maxLength={220} dir="rtl" /></label>
    <label>Date of birth<input name="dateOfBirth" type="date" /></label>
    <label>Sex at birth<select name="sexAtBirth" defaultValue="UNKNOWN"><option value="UNKNOWN">Unknown</option><option value="MALE">Male</option><option value="FEMALE">Female</option></select></label>
    <label>Phone<input name="phone" maxLength={50} /></label>
    <label>Email<input name="email" type="email" maxLength={191} /></label>
    <label>National ID<input name="nationalId" maxLength={120} /></label>
    <label>Nationality code<input name="nationalityCode" maxLength={2} placeholder="AE" /></label>
    <button className="primary-button form-span" disabled={busy}>{busy ? "Saving…" : "Create Patient"}</button>
    {message && <div className="form-success form-span">{message}</div>}
  </form>;
}
