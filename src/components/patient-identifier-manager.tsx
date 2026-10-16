"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

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
  const [formError, setFormError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [deactivation, setDeactivation] = useState<Identifier | null>(null);
  const [deactivationReason, setDeactivationReason] = useState("");
  const selected = useMemo(() => schemes.find(item => item.id === schemeId) || null, [schemeId, schemes]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !schemes.some(item => item.id === schemeId)) return;
    const form = new FormData(event.currentTarget);
    setBusy("add");
    setFormError("");
    try {
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
      if (!response.ok) {
        setFormError(body.error || tr("Could not add identifier.", "تعذر إضافة المعرّف."));
        return;
      }
      setCreateOpen(false);
      setMessage(tr("Identifier added.", "تمت إضافة المعرّف."));
      router.refresh();
    } catch {
      setFormError(tr("Connection interrupted; review identifiers before retrying.", "انقطع الاتصال؛ راجع معرّفات المريض قبل إعادة المحاولة."));
    } finally {
      setBusy("");
    }
  }

  function openDeactivation(identifier: Identifier) {
    if (busy || identifier.status !== "ACTIVE") return;
    setDeactivation(identifier);
    setDeactivationReason("");
    setFormError("");
    setMessage("");
  }

  async function deactivate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deactivation || busy) return;
    const reason = deactivationReason.trim();
    if (!reason) {
      setFormError(tr("A documented deactivation reason is required.", "سبب التعطيل الموثق إلزامي."));
      return;
    }
    setBusy(deactivation.id);
    setFormError("");
    try {
      const response = await fetch("/api/patients/" + patientId + "/identifiers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifierId: deactivation.id, reason }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setFormError(body.error || tr("Could not deactivate identifier.", "تعذر تعطيل المعرّف."));
        return;
      }
      setDeactivation(null);
      setMessage(tr("Identifier deactivated and audited.", "تم تعطيل المعرّف وتوثيق الإجراء."));
      router.refresh();
    } catch {
      setFormError(tr("Connection interrupted; verify identifier status before retrying.", "انقطع الاتصال؛ تحقق من حالة المعرّف قبل إعادة المحاولة."));
    } finally {
      setBusy("");
    }
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
          {identifier.status === "ACTIVE" && <button type="button" className="secondary-button" disabled={busy === identifier.id} onClick={() => openDeactivation(identifier)}>{tr("Deactivate", "تعطيل")}</button>}
        </span>
      </div>)}
    </div>

    {schemes.length > 0 && <button type="button" className="primary-button"
      disabled={Boolean(busy)} onClick={() => { setFormError(""); setMessage(""); setCreateOpen(true); }}>
      {tr("Add Identifier", "إضافة معرّف")}
    </button>}
    <CrudModal open={createOpen} onClose={() => { if (!busy) setCreateOpen(false); }}
      size="compact"
      title={tr("Add Patient Identifier", "إضافة معرّف المريض")}
      description={tr(
        "Confirm the identifier type and exact patient identity. Historical identity and audit events are retained.",
        "تأكد من نوع المعرّف وهوية المريض الدقيقة، مع الاحتفاظ بسجلات الهوية والتدقيق التاريخية.",
      )}>
      {createOpen && schemes.length > 0 && <form className="catalog-form" onSubmit={add}>
      <label>{tr("Identifier type", "نوع المعرّف")}<select value={schemeId} onChange={event => setSchemeId(event.target.value)}>
        {schemes.map(scheme => <option key={scheme.id} value={scheme.id}>{scheme.code} — {locale === "ar" ? scheme.nameAr || scheme.nameEn : scheme.nameEn}</option>)}
      </select></label>
      <label>{tr("Value", "القيمة")}<input name="value" maxLength={120} required /></label>
      {selected?.requiresIssuingCountry && <label>{tr("Issuing country", "بلد الإصدار")}<input name="issuingCountry" maxLength={2} required placeholder={tr("ISO code", "رمز ISO")} /></label>}
      <button className="primary-button form-span" disabled={busy === "add"}>{busy === "add" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Identifier", "إضافة معرّف")}</button>
      {formError && <p className="form-error form-span" role="alert">{formError}</p>}
    </form>}
    </CrudModal>
    <CrudModal open={deactivation !== null}
      onClose={() => { if (!busy) setDeactivation(null); }}
      size="compact"
      title={tr("Deactivate Patient Identifier", "تعطيل معرّف المريض")}
      description={tr(
        "Only this selected identifier is deactivated. Patient records and historical identifiers are never deleted.",
        "سيُعطَّل المعرّف المحدد فقط دون حذف سجلات المرضى أو المعرّفات التاريخية.",
      )}>
      {deactivation && <form className="catalog-form" onSubmit={deactivate}>
        <div className="form-span">
          <strong>{deactivation.scheme.code}</strong>
          <p dir="auto">{deactivation.value}</p>
        </div>
        <label className="form-span">{tr("Reason for deactivation (required)", "سبب التعطيل (مطلوب)")}
          <textarea required rows={3} maxLength={1000}
            value={deactivationReason} onChange={event => setDeactivationReason(event.target.value)} />
        </label>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
        <button className="primary-button form-span" type="submit"
          disabled={Boolean(busy) || !deactivationReason.trim()}>
          {busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Confirm deactivation", "تأكيد التعطيل")}
        </button>
      </form>}
    </CrudModal>

    {message && <p className="form-warning">{message}</p>}
  </section>;
}
