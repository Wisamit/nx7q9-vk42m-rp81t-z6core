"use client";

import { useState } from "react";
import { CrudModal } from "@/components/crud-modal";
import { OrderCreateForm, type DoctorRequisitionPrefill } from "@/components/order-create-form";
import { SystemIcon } from "@/components/system-icon";

type PatientOption = { id: string; patientNumber: string; fullNameEn: string; phone: string | null };
type OrderQuestionChoice = {
  code: string;
  valueEn: string;
  valueAr: string | null;
};
type OrderQuestionOption = {
  id: string; code: string; questionEn: string; questionAr: string | null;
  responseType: "TEXT" | "NUMERIC" | "BOOLEAN" | "DATE" | "DATETIME" | "SINGLE_CHOICE";
  required: boolean; options: OrderQuestionChoice[]; displayOrder: number;
};
type TestOption = { id: string; code: string; nameEn: string; orderQuestions: OrderQuestionOption[] };
type PackageOption = { id: string; code: string; nameEn: string; testIds: string[] };
type SimpleOption = { id: string; code: string; nameEn: string };
type ReferrerOption = SimpleOption & { clientId: string | null };
type SourceOption = SimpleOption & { category: string };
type BranchOption = SimpleOption & { timezone: string };

export function OrderCreateModal(props: {
  patients: PatientOption[];
  tests: TestOption[];
  packages: PackageOption[];
  clients: SimpleOption[];
  referrers: ReferrerOption[];
  sources: SourceOption[];
  branches: BranchOption[];
  activeBranchId: string | null;
  discountLimitPercent: number;
  locale: "ar" | "en";
  initialDoctorRequisition?: DoctorRequisitionPrefill | null;
}) {
  const tr = <T,>(en: T, ar: T) => props.locale === "ar" ? ar : en;
  const [open, setOpen] = useState(Boolean(props.initialDoctorRequisition));
  const [notice, setNotice] = useState("");

  return <>
    <div className="crud-trigger-row">
      {notice && <span className="crud-success-toast">{notice}</span>}
      <button type="button" className="primary-button" onClick={() => setOpen(true)}>
        <SystemIcon name="plus" size={16} />{tr("New Order", "طلب جديد")}
      </button>
    </div>
    <CrudModal
      open={open}
      onClose={() => setOpen(false)}
      title={tr("New Laboratory Order", "طلب مختبر جديد")}
      description={props.initialDoctorRequisition ? tr(
        "Verify physician requisition and complete standard reception pricing, billing, questions and specimen routing.",
        "راجع إحالة الطبيب وأكمل التسعير والفوترة والأسئلة ومتطلبات العينات عبر إجراءات الاستقبال الاعتيادية."
      ) : tr("Select patient, tests, source, billing context and any approved discount. The invoice is created from immutable pricing snapshots.", "اختر المريض والفحوصات والمصدر وبيانات الفوترة وأي خصم معتمد. يتم إنشاء الفاتورة من لقطات أسعار تاريخية غير قابلة للتغيير.")}
      size="compact"
    >
      <div className="order-modal-compact-flow">
        <p className="order-modal-guidance" role="note">{tr(
          "Review patient identity, ordering branch and test selection carefully. Then review the clinical questions, discount and invoice before registering. All fields remain available without hidden steps.",
          "راجع هوية المريض وفرع الطلب والفحوصات بعناية، ثم الأسئلة السريرية والخصم والفاتورة قبل التسجيل. تبقى جميع الحقول متاحة دون خطوات مخفية.",
        )}</p>
        <OrderCreateForm {...props} locale={props.locale} onSuccess={message => {
          setNotice(message);
          setOpen(false);
        }} />
      </div>
    </CrudModal>
  </>;
}
