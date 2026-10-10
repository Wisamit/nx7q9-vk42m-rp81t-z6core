"use client";

import { useState } from "react";
import {
  catalogPolicyChoices, policyKeys, type CatalogPolicyProposal,
  type CatalogPolicyKey,
} from "@/lib/catalog-policy-options";

type PublicPolicyDraft = {
  revision: number; proposal: CatalogPolicyProposal; proposalDigest: string;
  state: "UNAPPROVED_DRAFT"; reviewOnly: true;
  approved: false; signingEnabled: false; activated: false; liveWrites: false;
};
const initial = Object.fromEntries(
  policyKeys.map(key => [key, "UNDECIDED"]),
) as CatalogPolicyProposal;

const wording: Record<CatalogPolicyKey, [string, string]> = {
  clinicalAuthority: ["Proposed clinical authorization owner", "المسؤول الطبي المقترح"],
  financialAuthority: ["Proposed financial authorization owner", "المسؤول المالي المقترح"],
  branchDelegation: ["Proposed branch coverage", "تغطية الفروع المقترحة"],
  reviewerSeparation: ["Maker-checker separation proposal", "مقترح فصل المُعدّ عن المُراجعين"],
  signerAuthentication: ["Future signature authentication proposal", "مقترح مصادقة التوقيع مستقبلاً"],
  versionedApplication: ["Future activation/versioning proposal", "مقترح التفعيل وحفظ الإصدارات"],
  clinicalSafetyCheck: ["Clinical safety review proposal", "مقترح التحقق من السلامة السريرية"],
};
const values: Record<string, [string, string]> = {
  UNDECIDED: ["Unresolved — decision required", "غير محسوم — يحتاج قراراً"],
  MEDICAL_DIRECTOR: ["Medical director (proposed)", "المدير الطبي (مقترح)"],
  DESIGNATED_CLINICAL_LEAD: ["Designated clinical lead (proposed)", "مسؤول سريري مفوّض (مقترح)"],
  FINANCE_DIRECTOR: ["Finance director (proposed)", "المدير المالي (مقترح)"],
  DESIGNATED_FINANCIAL_LEAD: ["Designated finance lead (proposed)", "مسؤول مالي مفوّض (مقترح)"],
  BRANCH_SPECIFIC: ["Separate authority per branch", "صلاحية منفصلة لكل فرع"],
  CENTRAL_WITH_BRANCH_SCOPE: ["Central authority with branch restrictions", "صلاحية مركزية مقيّدة بالفروع"],
  AUTHOR_AND_TWO_DISTINCT_REVIEWERS: ["Author and two different clinical/financial reviewers", "المُعدّ ومراجعان طبي ومالي مختلفان"],
  MFA_REAUTH_AT_SIGNING: ["MFA and fresh authentication at signing", "المصادقة المتعددة وإعادة التحقق عند التوقيع"],
  ATOMIC_EFFECTIVE_DATED_VERSIONING: ["Versioned atomic activation by effective date", "تفعيل ذري بتاريخ سريان مع حفظ الإصدارات"],
  INDEPENDENT_CLINICAL_RANGE_REVIEW: ["Separate clinical review of ranges and critical values", "مراجعة سريرية مستقلة للمديات والقيم الحرجة"],
};

export function CatalogPolicyDraftEditor({
  batchId, locale, savedDraft, onSaved,
}: {
  batchId: string; locale: "ar" | "en";
  savedDraft: PublicPolicyDraft | null;
  onSaved: (draft: PublicPolicyDraft) => void;
}) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [choices, setChoices] = useState<CatalogPolicyProposal>(
    savedDraft?.proposal || initial,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const unresolved = policyKeys.filter(key => choices[key] === "UNDECIDED").length;

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        "/api/catalog/imports/" + encodeURIComponent(batchId) +
          "/bundle-drift?policyDraft=1", {
          method: "POST", cache: "no-store", credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedRevision: savedDraft?.revision || 0, proposal: choices,
          }),
        },
      );
      const body = await response.json() as {
        error?: string; policyDraft?: PublicPolicyDraft;
        policyDraftSave?: "RECORDED" | "UNCHANGED"; approved?: boolean;
        activationAllowed?: boolean; liveWrites?: boolean;
      };
      const draft = body.policyDraft;
      if (!response.ok || !draft || draft.state !== "UNAPPROVED_DRAFT" ||
          draft.reviewOnly !== true || draft.approved !== false ||
          draft.signingEnabled !== false || draft.activated !== false ||
          draft.liveWrites !== false || body.approved !== false ||
          body.activationAllowed !== false || body.liveWrites !== false ||
          !Number.isSafeInteger(draft.revision) ||
          !["RECORDED", "UNCHANGED"].includes(body.policyDraftSave || "")) {
        throw new Error(body.error || "policy_draft_save_unavailable");
      }
      onSaved(draft);
      setChoices(draft.proposal);
      setMessage(body.policyDraftSave === "RECORDED"
        ? tr("Nonbinding draft revision recorded in Audit. No authorization was granted.",
          "سُجّلت نسخة جديدة من المسودة غير الملزمة في Audit، دون منح أي صلاحية اعتماد.")
        : tr("No change; existing draft revision preserved.",
          "لا تغيير؛ احتُفظ بنفس نسخة المسودة."));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "policy_draft_save_unavailable");
    } finally {
      setBusy(false);
    }
  }

  return <section className="table-card no-print">
    <h3>{tr("Nonbinding signature-policy proposal — DRAFT ONLY",
      "مقترح سياسة التوقيع — مسودة غير ملزمة فقط")}</h3>
    <p className="muted">{tr(
      "These selections are discussion proposals, not an approved policy. No person acquires signing rights, and no clinical or financial data can be activated by saving this form.",
      "هذه الخيارات مقترحات للنقاش وليست سياسة معتمدة. حفظ النموذج لا يمنح أي مستخدم حق التوقيع ولا يفعّل أية بيانات طبية أو مالية.",
    )}</p>
    <p>{tr("Recorded revision", "النسخة المسجلة")}: <strong>{
      savedDraft?.revision || 0
    }</strong> · {tr("Unresolved topics", "المواضيع غير المحسومة")}: <strong>{unresolved}</strong></p>
    <div className="form-grid">{policyKeys.map(key => (
      <label key={key}>
        <span>{tr(...wording[key])}</span>
        <select value={choices[key]} disabled={busy}
          onChange={event => setChoices(previous => ({
            ...previous, [key]: event.target.value,
          }))}>
          {catalogPolicyChoices[key].map(option => (
            <option key={option} value={option}>{tr(...values[option])}</option>
          ))}
        </select>
      </label>
    ))}</div>
    <p className="muted">{tr(
      "A future formal approval process requires named signatory appointments, legal and clinical governance, re-authentication, independent authorization, cryptographic signature evidence and effective-dated immutable application. None is enabled here.",
      "الاعتماد الرسمي مستقبلاً يتطلّب تعيين الموقّعين المعتمدين وحوكمة طبية وقانونية وإعادة مصادقة واعتماداً مستقلاً ودليل توقيع موثوقاً وتطبيقاً محفوظ الإصدارات بتاريخ سريان. لم يُفعّل أي منها هنا.",
    )}</p>
    <button type="button" className="secondary-button"
      onClick={() => void save()} disabled={busy}>
      {busy ? tr("Recording draft…", "جارٍ تسجيل المسودة…")
        : tr("Record nonbinding draft in Audit", "تسجيل مسودة غير ملزمة في Audit")}
    </button>
    {error && <p role="alert">{tr("Draft not recorded: ", "لم تُسجّل المسودة: ")}{error}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
