"use client";

import { useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { PaymentForm } from "@/components/payment-form";
import { SystemIcon } from "@/components/system-icon";

type InvoiceOption = {
  id: string;
  invoiceNumber: string;
  currency: string;
  balanceAmount: string;
};

export function PaymentCreateModal({ invoices }: { invoices: InvoiceOption[] }) {
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  return <>
    <div className="crud-trigger-row">
      {notice && <span className="crud-success-toast">{notice}</span>}
      <button type="button" className="primary-button" disabled={invoices.length === 0} onClick={() => setOpen(true)}>
        <SystemIcon name="plus" size={16} /> Post Payment
      </button>
    </div>
    <CrudModal
      open={open}
      onClose={() => setOpen(false)}
      title="Post Payment"
      description="Allocate a payment to an open invoice while preserving invoice history."
      size="md"
    >
      <PaymentForm invoices={invoices} onSuccess={message => {
        setNotice(message);
        setOpen(false);
      }} />
    </CrudModal>
  </>;
}
