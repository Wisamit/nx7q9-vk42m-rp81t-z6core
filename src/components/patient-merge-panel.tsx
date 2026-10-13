"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { StaffStepUpDialog } from "@/components/staff-step-up-dialog";

type MergePatient = {
  id: string;
  patientNumber: string;
  fullNameEn: string;
  fullNameAr: string | null;
  dateOfBirth: string | null;
  phone: string | null;
  hasPortalAccount: boolean;
  evidence: Array<"NAME_DOB" | "PHONE">;
};

export function PatientMergePanel({
  current,
  candidates,
  locale,
  activeBranchId,
}: {
  activeBranchId: string;
  current: MergePatient;
  candidates: MergePatient[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [pendingMerge, setPendingMerge] = useState<{
    source: MergePatient; target: MergePatient; reason: string;
  } | null>(null);
  const evidenceLabel = (code: MergePatient["evidence"][number]) =>
    code === "NAME_DOB"
      ? tr("Same normalized name + date of birth", "نفس الاسم المطبع + تاريخ الميلاد")
      : tr("Same phone", "نفس رقم الهاتف");

  async function merge(source: MergePatient, target: MergePatient) {
    if (source.hasPortalAccount && target.hasPortalAccount) {
      setMessage(tr(
        "Both patient records have portal accounts. Resolve the portal identity conflict before merging.",
        "كلا سجلي المريض مرتبطان بحساب بوابة. يجب معالجة تعارض هوية البوابة قبل الدمج.",
      ));
      return;
    }

    const reason = window.prompt(tr(
      "Reason for merging " + source.patientNumber + " into " + target.patientNumber + ". This action preserves historical records and cannot be undone from the UI:",
      "سبب دمج " + source.patientNumber + " ضمن " + target.patientNumber + ". سيتم حفظ السجلات التاريخية ولا يمكن التراجع عن الدمج من الواجهة:",
    ));
    if (!reason?.trim()) return;

    const confirmation = window.confirm(tr(
      "Confirm merge: " + source.patientNumber + " will become an inactive alias of " + target.patientNumber + ". Historical orders/results will stay on their original record.",
      "تأكيد الدمج: سيصبح " + source.patientNumber + " سجلاً بديلاً غير نشط مرتبطاً بـ " + target.patientNumber + ". ستبقى الطلبات والنتائج التاريخية على سجلها الأصلي.",
    ));
    if (!confirmation) return;

    setPendingMerge({ source, target, reason: reason.trim() });
  }

  async function commitMerge(source: MergePatient, target: MergePatient, reason: string, stepUpToken: string) {
    setBusy(source.id + ":" + target.id);
    setMessage("");
    const response = await fetch("/api/patients/" + source.id + "/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-staff-step-up-token": stepUpToken },
      body: JSON.stringify({ targetPatientId: target.id, reason }),
    });
    const body = await response.json().catch(() => ({})) as {
      error?: string;
      targetPatientId?: string;
      targetPatientNumber?: string;
    };
    setBusy("");

    if (!response.ok) {
      const errors: Record<string, string> = {
        same_patient: tr("A patient cannot be merged into the same record.", "لا يمكن دمج المريض ضمن السجل نفسه."),
        patient_not_found: tr("One of the patient records no longer exists.", "أحد سجلي المريض لم يعد موجوداً."),
        source_not_mergeable: tr("The source patient is inactive or was already merged.", "سجل المريض المصدر غير نشط أو سبق دمجه."),
        target_not_canonical: tr("The target patient must be an active canonical record.", "يجب أن يكون سجل المريض الهدف سجلاً أساسياً نشطاً."),
        portal_account_conflict: tr("Both records have portal accounts. Resolve that identity conflict first.", "كلا السجلين مرتبطان بحسابي بوابة. عالج تعارض الهوية أولاً."),
        merge_conflict: tr("The patient changed during the merge. Refresh and review again.", "تغير سجل المريض أثناء الدمج. حدّث الصفحة وراجع السجلين من جديد."),
        fresh_staff_reauthentication_required: tr("Fresh identity verification required. Start the merge again.", "يلزم تأكيد هوية جديد. أعد بدء الدمج."),
        step_up_session_or_branch_changed: tr("Active branch or session changed. Sign in to the correct branch and retry.", "تغير الفرع النشط أو الجلسة. ادخل إلى الفرع الصحيح وأعد المحاولة."),
        portal_account_move_conflict: tr("The portal account changed during the merge. Refresh and review again.", "تغير حساب البوابة أثناء الدمج. حدّث الصفحة وراجع من جديد."),
      };
      setMessage(errors[body.error || ""] || tr("Patient merge failed.", "فشل دمج سجل المريض."));
      return;
    }

    setMessage(tr(
      "Patient merged into " + (body.targetPatientNumber || target.patientNumber) + ".",
      "تم دمج سجل المريض ضمن " + (body.targetPatientNumber || target.patientNumber) + ".",
    ));
    router.push("/patients/" + (body.targetPatientId || target.id));
    router.refresh();
  }

  if (candidates.length === 0) return null;

  return <section className="detail-card">
    <h2>{tr("Duplicate Review & Merge", "مراجعة ودمج السجلات المكررة")}</h2>
    <p className="muted">{tr(
      "Choose the survivor explicitly. Merge never deletes historical orders, results, reports or financial records; the source becomes an inactive alias.",
      "اختر السجل الأساسي بشكل صريح. الدمج لا يحذف الطلبات أو النتائج أو التقارير أو السجلات المالية التاريخية؛ بل يصبح السجل المصدر اسماً بديلاً غير نشط.",
    )}</p>
    <div className="summary-list">
      {candidates.map(candidate => {
        const portalConflict = current.hasPortalAccount && candidate.hasPortalAccount;
        return <div key={candidate.id}>
          <span>
            <strong>{candidate.patientNumber} · {locale === "ar" ? candidate.fullNameAr || candidate.fullNameEn : candidate.fullNameEn}</strong>
            <small className="table-subtext">
              {candidate.dateOfBirth || tr("DOB —", "الميلاد —")} · {candidate.phone || tr("Phone —", "الهاتف —")}
              {candidate.hasPortalAccount ? " · " + tr("Portal account", "حساب بوابة") : ""}
              {candidate.evidence.length ? " · " + candidate.evidence.map(evidenceLabel).join(" · ") : ""}
            </small>
          </span>
          <span className="inline-actions">
            <button
              type="button"
              className="secondary-button compact-action"
              disabled={busy !== "" || portalConflict}
              onClick={() => void merge(candidate, current)}
            >
              {tr("Keep current", "اعتماد السجل الحالي")}
            </button>
            <button
              type="button"
              className="secondary-button compact-action"
              disabled={busy !== "" || portalConflict}
              onClick={() => void merge(current, candidate)}
            >
              {tr("Keep candidate", "اعتماد السجل المقترح")}
            </button>
          </span>
          {portalConflict && <small className="muted">{tr(
            "Merge blocked: both records have portal identities.",
            "الدمج متوقف: كلا السجلين مرتبطان بهوية بوابة.",
          )}</small>}
        </div>;
      })}
    </div>
    {message && <p className="muted">{message}</p>}
    <StaffStepUpDialog open={pendingMerge !== null} action="PATIENT_MERGE"
      resourceKey={pendingMerge ? [pendingMerge.source.id, pendingMerge.target.id].join(":") : ""}
      branchId={activeBranchId} locale={locale}
      onCancel={() => setPendingMerge(null)}
      onGranted={token => {
        const item = pendingMerge;
        setPendingMerge(null);
        if (item) void commitMerge(item.source, item.target, item.reason, token);
      }} />
  </section>;
}
