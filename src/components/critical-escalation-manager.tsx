"use client";
import { SystemDateField } from "@/components/system-date-field";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Option = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };

export function CriticalEscalationManager({
  tests,
  branches,
  locale,
}: {
  tests: Option[];
  branches: Branch[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [open, setOpen] = useState(false);
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch("/api/clinical-rules/critical-escalation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testId: form.get("testId"),
          branchId: form.get("branchId"),
          acknowledgementMinutes: form.get("acknowledgementMinutes"),
          escalationIntervalMinutes: form.get("escalationIntervalMinutes"),
          maxEscalationLevel: form.get("maxEscalationLevel"),
          requireReadBack: form.get("requireReadBack") === "on",
          effectiveFrom: form.get("effectiveFrom"),
          effectiveTo: form.get("effectiveTo"),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        setFormError(body.error || tr("Could not create critical escalation policy.", "تعذر إنشاء سياسة تصعيد النتائج الحرجة."));
        return;
      }
      setOpen(false);
      setMessage(tr(
        "Critical escalation policy draft created. Approval is required before it controls live critical events.",
        "تم إنشاء مسودة سياسة تصعيد النتائج الحرجة. يلزم اعتمادها قبل أن تتحكم بالأحداث الحرجة الفعلية.",
      ));
      router.refresh();
    } catch {
      setFormError(tr("Connection error; draft creation not confirmed.", "خطأ في الاتصال؛ لم يتم تأكيد إنشاء المسودة."));
    } finally {
      setBusy(false);
    }
  }

  return <section className="detail-card detail-section">
    <h2>{tr("Create Critical Escalation Policy", "إنشاء سياسة تصعيد للنتائج الحرجة")}</h2>
    <p className="muted">{tr("Controls acknowledgement deadline, escalation cadence, maximum escalation level and mandatory read-back for critical results.", "تحدد مهلة الإقرار ودورية التصعيد وأقصى مستوى للتصعيد ومتطلبات إعادة القراءة للنتائج الحرجة.")}</p>
    <button type="button" className="primary-button" disabled={busy}
      onClick={() => { setMessage(""); setFormError(""); setOpen(true); }}>
      {tr("Create Critical Escalation Draft", "إنشاء مسودة سياسة تصعيد")}
    </button>
    <CrudModal open={open} onClose={() => { if (!busy) setOpen(false); }}
      size="compact"
      title={tr("Create Critical Escalation Policy Draft", "إنشاء مسودة سياسة تصعيد النتائج الحرجة")}
      description={tr(
        "Inactive draft only. Clinical authorization is required before any critical communication deadline becomes effective.",
        "مسودة غير فعالة فقط؛ يلزم الاعتماد السريري قبل سريان أي مهلة لإبلاغ النتائج الحرجة.",
      )}>
      {open && <form className="catalog-form" onSubmit={submit}>
      <label>{tr("Test", "الفحص")}<select name="testId" required defaultValue="">
        <option value="">{tr("Select test…", "اختر الفحص…")}</option>
        {tests.map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}
      </select></label>
      <label>{tr("Branch", "الفرع")}<select name="branchId" defaultValue="">
        <option value="">{tr("All branches", "كل الفروع")}</option>
        {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}
      </select></label>
      <label>{tr("Acknowledgement deadline (minutes)", "مهلة الإقرار (بالدقائق)")}<input name="acknowledgementMinutes" type="number" min="1" max="1440" defaultValue="30" required /></label>
      <label>{tr("Escalation interval (minutes)", "فاصل التصعيد (بالدقائق)")}<input name="escalationIntervalMinutes" type="number" min="1" max="1440" defaultValue="15" required /></label>
      <label>{tr("Maximum escalation level", "أقصى مستوى للتصعيد")}<input name="maxEscalationLevel" type="number" min="1" max="10" defaultValue="3" required /></label>
      <label className="check-line"><input name="requireReadBack" type="checkbox" defaultChecked /> {tr("Require read-back on acknowledgement", "اشتراط إعادة القراءة عند الإقرار")}</label>
      <label>{tr("Effective from (select intended local date)", "ساري من (اختر التاريخ المحلي المقصود)")}<SystemDateField name="effectiveFrom" required /></label>
      <label>{tr("Effective to", "ساري حتى")}<SystemDateField name="effectiveTo" /></label>
      <button className="primary-button form-span" disabled={busy}>{busy ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Critical Escalation Policy Draft", "إنشاء مسودة سياسة التصعيد")}</button>
      {formError && <p className="form-error form-span" role="alert">{formError}</p>}
    </form>}
    </CrudModal>
    {message && <p className="form-success">{message}</p>}
  </section>;
}
