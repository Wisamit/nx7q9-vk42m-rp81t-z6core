"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";

type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type Method = { id: string; code: string; nameEn: string; nameAr?: string | null };
type ComponentOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
type TestOption = { id: string; code: string; nameEn: string; nameAr?: string | null; methodId: string | null; components: ComponentOption[] };

export function ClinicalRulesManager({
  tests,
  branches,
  methods,
  locale,
}: {
  tests: TestOption[];
  branches: Branch[];
  methods: Method[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [deltaTestId, setDeltaTestId] = useState("");
  const [commentTestId, setCommentTestId] = useState("");
  const [commentScope, setCommentScope] = useState("ORGANIZATION");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [formError, setFormError] = useState("");
  const [open, setOpen] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;

  const deltaComponents = useMemo(
    () => tests.find(test => test.id === deltaTestId)?.components || [],
    [tests, deltaTestId],
  );
  const commentComponents = useMemo(
    () => tests.find(test => test.id === commentTestId)?.components || [],
    [tests, commentTestId],
  );

  async function createDelta(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("delta");
    setFormError("");
    try {
      const response = await fetch("/api/clinical-rules/delta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testId: form.get("testId"),
          componentId: form.get("componentId"),
          branchId: form.get("branchId"),
          methodId: form.get("methodId"),
          absoluteLimit: form.get("absoluteLimit"),
          percentLimit: form.get("percentLimit"),
          lookbackDays: form.get("lookbackDays"),
          effectiveFrom: form.get("effectiveFrom"),
          effectiveTo: form.get("effectiveTo"),
        }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string };
        setFormError(tr("Could not create delta rule.", "تعذر إنشاء قاعدة الفرق.") +
          (detail.error ? " (" + detail.error + ")" : ""));
        return;
      }
      setMessage(tr("Delta rule draft created. Approval is required before clinical use.", "تم إنشاء مسودة قاعدة Delta. يلزم اعتمادها قبل الاستخدام السريري."));
      setOpen("");
      setDeltaTestId("");
      router.refresh();
    } catch {
      setFormError(tr("Connection error. The draft was not confirmed as saved.", "خطأ في الاتصال. لم يتم تأكيد حفظ المسودة."));
    } finally {
      setBusy("");
    }
  }
  async function createComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy("comment");
    setFormError("");
    try {
      const response = await fetch("/api/clinical-rules/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: commentScope,
          testId: form.get("testId"),
          componentId: form.get("componentId"),
          code: form.get("code"),
          nameEn: form.get("nameEn"),
          nameAr: form.get("nameAr"),
          textEn: form.get("textEn"),
          textAr: form.get("textAr"),
        }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { error?: string };
        setFormError(tr("Could not create comment draft.", "تعذر إنشاء قالب التعليق.") +
          (detail.error ? " (" + detail.error + ")" : ""));
        return;
      }
      setMessage(tr("Inactive comment draft saved. A different authorized reviewer must approve it in Comment Approvals before clinical use.", "تم حفظ قالب التعليق غير مفعّل. يجب اعتماده من مراجع سريري آخر عبر قائمة اعتماد التعليقات قبل استخدامه."));
      setOpen("");
      setCommentScope("ORGANIZATION");
            setCommentTestId("");
      router.refresh();
    } catch {
      setFormError(tr("Connection error. The draft was not confirmed as saved.", "خطأ في الاتصال. لم يتم تأكيد حفظ المسودة."));
    } finally {
      setBusy("");
    }
  }
  return <div className="detail-grid">
    <article className="detail-card">
      <h2>{tr("Create Delta Rule", "إنشاء قاعدة مقارنة سابقة")}</h2>
      <p className="muted">{tr("Compare a new numeric result against the patient's prior released value. Exceeding either configured threshold is flagged for review.", "تقارن النتيجة الرقمية الجديدة بآخر نتيجة صادرة للمريض، ويؤدي تجاوز أي حد مُهيأ إلى وضع علامة للمراجعة.")}</p>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
        onClick={() => { setMessage(""); setFormError(""); setOpen("delta"); }}>
        {tr("Create Delta Rule Draft", "إنشاء مسودة قاعدة مقارنة سابقة")}
      </button>
      <CrudModal open={open === "delta"}
        onClose={() => { if (!busy) setOpen(""); }}
        size="compact"
        title={tr("Create Delta Rule Draft", "إنشاء مسودة قاعدة مقارنة سابقة")}
        description={tr("Draft only: clinical approval is required before the rule can affect result review.", "مسودة فقط: يلزم الاعتماد السريري قبل أن تؤثر القاعدة على مراجعة النتائج.")}>
        {open === "delta" && <form className="catalog-form" onSubmit={createDelta}>
        <label>{tr("Test", "الفحص")}<select name="testId" required value={deltaTestId} onChange={e => setDeltaTestId(e.target.value)}>
          <option value="">{tr("Select test…", "اختر الفحص…")}</option>
          {tests.map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}
        </select></label>
        <label>{tr("Component", "المكوّن")}<select name="componentId" defaultValue="" disabled={!deltaTestId}>
          <option value="">{tr("Whole/simple test", "الفحص الكامل / البسيط")}</option>
          {deltaComponents.map(component => <option key={component.id} value={component.id}>{component.code} — {localizedName(component)}</option>)}
        </select></label>
        <label>{tr("Branch", "الفرع")}<select name="branchId" defaultValue=""><option value="">{tr("All branches", "كل الفروع")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {localizedName(branch)}</option>)}</select></label>
        <label>{tr("Method", "الطريقة")}<select name="methodId" defaultValue=""><option value="">{tr("All methods", "كل الطرق")}</option>{methods.map(method => <option key={method.id} value={method.id}>{method.code} — {localizedName(method)}</option>)}</select></label>
        <label>{tr("Absolute limit", "الحد المطلق")}<input name="absoluteLimit" type="number" min="0" step="0.00000001" /></label>
        <label>{tr("Percent limit", "حد النسبة المئوية")}<input name="percentLimit" type="number" min="0" step="0.000001" /></label>
        <label>{tr("Lookback days", "أيام الرجوع للخلف")}<input name="lookbackDays" type="number" min="1" max="3650" defaultValue="365" required /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "delta"}>{busy === "delta" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Delta Rule Draft", "إنشاء مسودة قاعدة الفرق")}</button>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
      </form>}
      </CrudModal>
    </article>

    <article className="detail-card">
      <h2>{tr("Create Result Comment Template", "إنشاء قالب تعليق للنتيجة")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
        onClick={() => { setMessage(""); setFormError(""); setOpen("comment"); }}>
        {tr("Create Result Comment Draft", "إنشاء مسودة قالب تعليق")}
      </button>
      <CrudModal open={open === "comment"}
        onClose={() => { if (!busy) setOpen(""); }}
        size="compact"
        title={tr("Create Result Comment Draft", "إنشاء مسودة قالب تعليق")}
        description={tr("New comments remain inactive until a different authorized reviewer approves them.", "تبقى التعليقات الجديدة غير مفعّلة حتى يعتمدها مراجع مخوّل آخر.")}>
        {open === "comment" && <form className="catalog-form" onSubmit={createComment}>
        <label>{tr("Scope", "النطاق")}<select value={commentScope} onChange={e => setCommentScope(e.target.value)}>
          <option value="ORGANIZATION">{tr("Organization", "المؤسسة")}</option>
          <option value="TEST">{tr("Test", "الفحص")}</option>
          <option value="COMPONENT">{tr("Component", "المكوّن")}</option>
        </select></label>
        <label>{tr("Code", "الرمز")}<input name="code" placeholder={tr("Optional; generated from name", "اختياري؛ يُنشأ من الاسم عند تركه فارغًا")} /></label>
        {commentScope !== "ORGANIZATION" && <label>{tr("Test", "الفحص")}<select name="testId" required value={commentTestId} onChange={e => setCommentTestId(e.target.value)}>
          <option value="">{tr("Select test…", "اختر الفحص…")}</option>{tests.map(test => <option key={test.id} value={test.id}>{test.code} — {localizedName(test)}</option>)}
        </select></label>}
        {commentScope === "COMPONENT" && <label>{tr("Component", "المكوّن")}<select name="componentId" required defaultValue=""><option value="">{tr("Select component…", "اختر المكوّن…")}</option>{commentComponents.map(component => <option key={component.id} value={component.id}>{component.code} — {localizedName(component)}</option>)}</select></label>}
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <label className="form-span">{tr("Comment (English)", "التعليق بالإنجليزية")}<textarea name="textEn" rows={3} required /></label>
        <label className="form-span">{tr("Comment (Arabic)", "التعليق بالعربية")}<textarea name="textAr" rows={3} dir="rtl" /></label>
        <button className="primary-button form-span" disabled={busy === "comment"}>{busy === "comment" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Comment Template", "إنشاء قالب التعليق")}</button>
        {formError && <p className="form-error form-span" role="alert">{formError}</p>}
      </form>}
      </CrudModal>
    </article>
    {message && <div className="form-success form-span">{message}</div>}
  </div>;
}
