"use client";

import { useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { OrderCreateForm } from "@/components/order-create-form";
import { SystemIcon } from "@/components/system-icon";

type PatientOption = { id: string; patientNumber: string; fullNameEn: string; phone: string | null };
type OrderQuestionOption = {
  id: string; code: string; questionEn: string; questionAr: string | null;
  responseType: "TEXT" | "NUMERIC" | "BOOLEAN" | "DATE" | "SINGLE_CHOICE";
  required: boolean; options: string[]; displayOrder: number;
};
type TestOption = { id: string; code: string; nameEn: string; orderQuestions: OrderQuestionOption[] };
type PackageOption = { id: string; code: string; nameEn: string; testIds: string[] };
type SimpleOption = { id: string; code: string; nameEn: string };
type ReferrerOption = SimpleOption & { clientId: string | null };
type SourceOption = SimpleOption & { category: string };
type BranchOption = SimpleOption;

export function OrderCreateModal(props: {
  patients: PatientOption[];
  tests: TestOption[];
  packages: PackageOption[];
  clients: SimpleOption[];
  referrers: ReferrerOption[];
  sources: SourceOption[];
  branches: BranchOption[];
  activeBranchId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  return <>
    <div className="crud-trigger-row">
      {notice && <span className="crud-success-toast">{notice}</span>}
      <button type="button" className="primary-button" onClick={() => setOpen(true)}>
        <SystemIcon name="plus" size={16} /> New Order
      </button>
    </div>
    <CrudModal
      open={open}
      onClose={() => setOpen(false)}
      title="New Laboratory Order"
      description="Select patient, tests, source and billing context. The invoice is created from effective pricing snapshots."
      size="full"
    >
      <OrderCreateForm {...props} onSuccess={message => {
        setNotice(message);
        setOpen(false);
      }} />
    </CrudModal>
  </>;
}
