"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Scheme = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  requiresIssuingCountry: boolean;
};

type Identifier = {
  id: string;
  value: string;
  issuingCountry: string | null;
  isPrimary: boolean;
  status: "ACTIVE" | "INACTIVE";
  scheme: {
    id: string;
    code: string;
    nameEn: string;
    nameAr: string | null;
  };
};

export function PatientIdentifierManager({
  patientId,
  schemes,
  identifiers,
  locale,
}: {
  patientId: string;
  schemes: Scheme[];
  identifiers: Identifier[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [schemeId, setSchemeId] = useState(schemes[0]?.id || "");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const selected = useMemo(() => schemes.find(item => item.id === schemeId) || null, [schemeId, schemes]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("add");
    setMessage("");
    const response = await fetch("/api/patients/" + patientId + "/identifiers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemeId,
        value: form.get("value"),
        issuingCountry: form.get("issuingCountry"),
      }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) {
      event.currentTarget.reset();
      setMessage(tr("Identifier added.", "تمت إضافة المعرّف."));
      router.refresh();
    } else {
      setMessage(body.error || tr("Could not add identifier.", "تعذر إضافة المعرّف."));
    }
    setBusy("");
  }

  async function deactivate(identifier: Identifier) {
    const reason = prompt(tr("Reason for deactivation:", "سبب تعطيل المعرّف:"));
    if (reason === null) return;
    if (!reason.trim()) {
      setMessage(tr("A reason is required.", "السبب مطلوب."));
      return;
    }
    setBusy(identifier.id);
    setMessage("");
    const response = await fetch("/api/patients/" + patientId + "/identifiers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifierId: identifier.id, reason: reason.trim() }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (response.ok) {
      setMessage(tr("Identifier deactivated.", "تم تعطيل المعرّف."));
      router.refresh();
    } else {
      setMessage(body.error || tr("Could not deactivate identifier.", "تعذر تعطيل المعرّف."));
    }
    setBusy("");
  }

  return <section className="detail-card">
    <h2>{tr("Patient Identifiers", "معرّفات المريض")}</h2>
    <div className="summary-list">
      {identifiers.map(identifier => <div key={identifier.id}>
        <span>
          <strong>{locale === "ar" ? identifier.scheme.nameAr || identifier.scheme.nameEn : identifier.scheme.nameEn}</strong>
          <small className="table-subtext">{identifier.scheme.code}{identifier.issuingCountry ? " · " + identifier.issuingCountry : ""}{identifier.isPrimary ? " · " + tr("Primary", "رئيسي") : ""}</small>
        </span>
        <span>
          <strong>{identifier.value}</strong>
          {identifier.status === "ACTIVE" && <button type="button" className="secondary-button" disabled={busy === identifier.id} onClick={() => void deactivate(identifier)}>{tr("Deactivate", "تعطيل")}</button>}
        </span>
      </div>)}
    </div>

    {schemes.length > 0 && <form className="catalog-form" onSubmit={add}>
      <label>{tr("Identifier type", "نوع المعرّف")}<select value={schemeId} onChange={event => setSchemeId(event.target.value)}>
        {schemes.map(scheme => <option key={scheme.id} value={scheme.id}>{scheme.code} — {locale === "ar" ? scheme.nameAr || scheme.nameEn : scheme.nameEn}</option>)}
      </select></label>
      <label>{tr("Value", "القيمة")}<input name="value" maxLength={120} required /></label>
      {selected?.requiresIssuingCountry && <label>{tr("Issuing country", "بلد الإصدار")}<input name="issuingCountry" maxLength={2} required placeholder={tr("ISO code", "رمز ISO")} /></label>}
      <button className="primary-button form-span" disabled={busy === "add"}>{busy === "add" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Identifier", "إضافة معرّف")}</button>
    </form>}

    {message && <p className="form-warning">{message}</p>}
  </section>;
}
