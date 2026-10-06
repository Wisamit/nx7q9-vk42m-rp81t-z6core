"use client";

import { useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { PatientCreateForm } from "@/components/patient-create-form";
import { SystemIcon } from "@/components/system-icon";

export function PatientCreateModal() {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  return <>
    <div className="crud-trigger-row">
      {notice && <span className="crud-success-toast">{notice}</span>}
      <button type="button" className="primary-button" onClick={() => setOpen(true)}>
        <SystemIcon name="plus" size={16} /> New Patient
      </button>
    </div>
    <CrudModal
      open={open}
      onClose={() => setOpen(false)}
      title="Register Patient"
      description="Create a central patient record shared across all branches."
      size="lg"
    >
      <PatientCreateForm onSuccess={message => {
        setNotice(message);
        setOpen(false);
      }} />
    </CrudModal>
  </>;
}
