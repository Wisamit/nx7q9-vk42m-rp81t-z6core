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

type PaymentMethodOption = {
  id: string;
  code: string;
  name: string;
  baseMethod: string;
  requiresReference: boolean;
};

export function PaymentCreateModal({
  invoices,
  paymentMethods,
  locale,
}: {
  invoices: InvoiceOption[];
  paymentMethods: PaymentMethodOption[];
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  return <>
    <div className="crud-trigger-row">
      {notice && <span className="crud-success-toast">{notice}</span>}
      <button type="button" className="primary-button" disabled={invoices.length === 0 || paymentMethods.length === 0} onClick={() => setOpen(true)}>
        <SystemIcon name="plus" size={16} />{tr("Post Payment", "تسجيل دفعة")}
      </button>
    </div>
    <CrudModal
      open={open}
      onClose={() => setOpen(false)}
      title={tr("Post Payment", "تسجيل دفعة")}
      description={tr("Allocate a payment to an open invoice while preserving invoice history.", "تسجيل دفعة على فاتورة مفتوحة مع الحفاظ على السجل المالي التاريخي.")}
      size="compact"
    >
      <PaymentForm invoices={invoices} paymentMethods={paymentMethods} locale={locale} onSuccess={message => {
        setNotice(message);
        setOpen(false);
      }} />
    </CrudModal>
  </>;
}
