"use client";

import { useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { PatientCreateForm } from "@/components/patient-create-form";
import { SystemIcon } from "@/components/system-icon";

type IdentifierSchemeOption = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  requiresIssuingCountry: boolean;
};

export function PatientCreateModal({
  locale,
  identifierSchemes,
}: {
  locale: "ar" | "en";
  identifierSchemes: IdentifierSchemeOption[];
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  return <>
    <div className="crud-trigger-row">
      {notice && <span className="crud-success-toast">{notice}</span>}
      <button type="button" className="primary-button" onClick={() => setOpen(true)}>
        <SystemIcon name="plus" size={16} />{tr("New Patient", "مريض جديد")}
      </button>
    </div>
    <CrudModal
      open={open}
      onClose={() => setOpen(false)}
      title={tr("Register Patient", "تسجيل مريض")}
      description={tr("Create a central patient record shared across all branches.", "إنشاء سجل مركزي للمريض مشترك بين جميع الفروع.")}
      size="lg"
    >
      <PatientCreateForm locale={locale} identifierSchemes={identifierSchemes} onSuccess={message => {
        setNotice(message);
        setOpen(false);
      }} />
    </CrudModal>
  </>;
}
