"use client";

import { useState } from "react";
import { CatalogPolicyDraftEditor } from "@/components/catalog-policy-draft-editor";
import type { CatalogPolicyProposal } from "@/lib/catalog-policy-options";

type Category = "CLINICAL" | "FINANCIAL" | "CROSS_DOMAIN" | "CATALOG";
type PublicPolicyDraft = {
  revision: number; proposal: CatalogPolicyProposal; proposalDigest: string;
  state: "UNAPPROVED_DRAFT"; reviewOnly: true; approved: false;
  signingEnabled: false; activated: false; liveWrites: false;
};
type DomainReviewFeedback = {
  status: "PENDING" | "NOTED_FOR_DISCUSSION" | "RETURN_FOR_REVISION";
  reasonCode: string | null;
};
type PolicyReviewFeedback = {
  revision: number;
  domains: { CLINICAL: DomainReviewFeedback; FINANCIAL: DomainReviewFeedback };
  reviewOnly: true; approved: false; signingEnabled: false;
  activated: false; liveWrites: false;
};
type Count = {
  total: number; unchanged: number; drifted: number;
  unflagged: number; driftUnflagged: number; pending: number; expertConfirmed: number;
  returnedForCorrection: number; stale: number;
};
type GovernanceReport = {
  rowCount: number; sourceAttested: boolean;
  byCategory: Record<Category, Count>; totals: Count;
  blockers: string[];
  reviewOnly: boolean; approved: boolean; activationAllowed: boolean;
  clinicalReleaseAllowed: boolean; pricePublicationAllowed: boolean;
  liveWrites: boolean;
  policyDraft: PublicPolicyDraft | null;
  policyDraftSave: "RECORDED" | "UNCHANGED" | null;
  policyReviewFeedback: PolicyReviewFeedback | null;
  signatoryPlanning: {
    clinicalReviewerCandidates: number; financialReviewerCandidates: number;
    crossQualifiedReviewers: number; distinctPairAvailable: boolean;
    mfaEnabledPotentialReviewers: number; gaps: string[];
    candidateCountsOnly: boolean; qualificationToSign: boolean;
    signaturePolicyApproved: boolean; signingEnabled: boolean;
    clinicalApprovalAllowed: boolean; financialApprovalAllowed: boolean;
    liveWrites: boolean;
  };
};
const categories: Category[] = ["CLINICAL", "FINANCIAL", "CROSS_DOMAIN", "CATALOG"];
const knownBlockers = [
  "SIGNATORY_POLICY_UNCONFIGURED", "APPLICATION_WORKFLOW_UNAVAILABLE",
  "SOURCE_NOT_ATTESTED", "DRIFT_NOT_TRIAGED", "EXPERT_REVIEW_PENDING",
  "EXPERT_RETURNED_FOR_CORRECTION", "STALE_REVIEW_EVIDENCE",
];

export function CatalogGovernanceReadiness({ batchId, locale }: {
  batchId: string; locale: "ar" | "en";
}) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [report, setReport] = useState<GovernanceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function inspect() {
    if (busy) return;
    setBusy(true);
    setReport(null);
    setError("");
    try {
      const response = await fetch("/api/catalog/imports/" + encodeURIComponent(batchId) +
        "/bundle-drift?governance=1", {
        cache: "no-store", credentials: "same-origin",
      });
      const body = await response.json() as Partial<GovernanceReport> & { error?: string };
      if (!response.ok || body.reviewOnly !== true || body.approved !== false ||
          body.activationAllowed !== false || body.clinicalReleaseAllowed !== false ||
          body.pricePublicationAllowed !== false || body.liveWrites !== false ||
          typeof body.rowCount !== "number" || !Number.isSafeInteger(body.rowCount) ||
          body.rowCount < 1 || body.rowCount > 5000 ||
          typeof body.sourceAttested !== "boolean" ||
          !Array.isArray(body.blockers) ||
          !body.blockers.includes("SIGNATORY_POLICY_UNCONFIGURED") ||
          !body.blockers.includes("APPLICATION_WORKFLOW_UNAVAILABLE") ||
          body.blockers.some(code => !knownBlockers.includes(code)) ||
          !body.signatoryPlanning ||
          body.signatoryPlanning.candidateCountsOnly !== true ||
          body.signatoryPlanning.qualificationToSign !== false ||
          body.signatoryPlanning.signaturePolicyApproved !== false ||
          body.signatoryPlanning.signingEnabled !== false ||
          body.signatoryPlanning.clinicalApprovalAllowed !== false ||
          body.signatoryPlanning.financialApprovalAllowed !== false ||
          body.signatoryPlanning.liveWrites !== false ||
          (body.policyReviewFeedback !== null &&
            (!body.policyReviewFeedback || !body.policyDraft ||
             body.policyReviewFeedback.revision !== body.policyDraft.revision ||
             body.policyReviewFeedback.reviewOnly !== true ||
             body.policyReviewFeedback.approved !== false ||
             body.policyReviewFeedback.signingEnabled !== false ||
             body.policyReviewFeedback.activated !== false ||
             body.policyReviewFeedback.liveWrites !== false ||
             !(["CLINICAL", "FINANCIAL"] as const).every(domain => {
               const state = body.policyReviewFeedback?.domains?.[domain];
               return state && ["PENDING", "NOTED_FOR_DISCUSSION", "RETURN_FOR_REVISION"]
                 .includes(state.status) && (state.status === "PENDING"
                 ? state.reasonCode === null : typeof state.reasonCode === "string");
             }))) ||
          (body.policyDraft !== null && body.policyReviewFeedback === null) ||
          (body.policyDraft !== null &&
            (!body.policyDraft || body.policyDraft.state !== "UNAPPROVED_DRAFT" ||
              body.policyDraft.approved !== false || body.policyDraft.reviewOnly !== true ||
              body.policyDraft.signingEnabled !== false ||
              body.policyDraft.activated !== false || body.policyDraft.liveWrites !== false)) ||
          !Number.isSafeInteger(body.signatoryPlanning.clinicalReviewerCandidates) ||
          !Number.isSafeInteger(body.signatoryPlanning.financialReviewerCandidates) ||
          !Number.isSafeInteger(body.signatoryPlanning.crossQualifiedReviewers) ||
          !Number.isSafeInteger(body.signatoryPlanning.mfaEnabledPotentialReviewers) ||
          !body.totals || !body.byCategory ||
          !categories.every(category => body.byCategory?.[category] &&
            Number.isSafeInteger(body.byCategory[category].total) &&
            Number.isSafeInteger(body.byCategory[category].driftUnflagged))) {
        throw new Error(body.error || "governance_review_unavailable");
      }
      setReport(body as GovernanceReport);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "governance_review_unavailable");
    } finally {
      setBusy(false);
    }
  }

  const reviewReason = (code: string) => {
    const reasons: Record<string, [string, string]> = {
      NO_FURTHER_OBJECTION_TO_DISCUSSION: ["No further objection to discussion", "لا اعتراض إضافياً على النقاش"],
      CLINICAL_AUTHORITY_UNCLEAR: ["Clinical authority unclear", "المسؤولية الطبية غير واضحة"],
      FINANCIAL_AUTHORITY_UNCLEAR: ["Financial authority unclear", "المسؤولية المالية غير واضحة"],
      BRANCH_SCOPE_UNCLEAR: ["Branch delegation unclear", "صلاحيات الفروع غير واضحة"],
      MAKER_CHECKER_INDEPENDENCE_UNCLEAR: ["Reviewer independence unclear", "فصل المراجعين غير واضح"],
      REAUTHENTICATION_UNDEFINED: ["Reauthentication undefined", "إعادة المصادقة غير محددة"],
      VERSIONED_RELEASE_UNDEFINED: ["Versioned application undefined", "التطبيق وحفظ الإصدارات غير محددين"],
      CLINICAL_SAFETY_REVIEW_UNDEFINED: ["Clinical safety review undefined", "مراجعة السلامة السريرية غير محددة"],
    };
    return reasons[code] ? tr(...reasons[code]) : code;
  };
  const blockerName = (code: string) => {
    const labels: Record<string, [string, string]> = {
      SIGNATORY_POLICY_UNCONFIGURED: [
        "Formal medical/financial signatory policy is not configured",
        "سياسة التوقيع والاعتماد الطبي والمالي النهائي غير معتمدة",
      ],
      APPLICATION_WORKFLOW_UNAVAILABLE: [
        "Approved versioned application workflow is not enabled",
        "آلية التطبيق الموثّق مع حفظ الإصدارات غير مفعّلة",
      ],
      SOURCE_NOT_ATTESTED: [
        "Imported source has no verified original attestation",
        "ملف المصدر لا يحمل توثيقاً أصلياً متحققاً منه",
      ],
      DRIFT_NOT_TRIAGED: [
        "There are unreviewed configuration differences",
        "توجد اختلافات إعدادات لم تُحل للمراجعة",
      ],
      EXPERT_REVIEW_PENDING: [
        "Some referrals await independent expert review",
        "توجد إحالات تنتظر المراجع المستقل",
      ],
      EXPERT_RETURNED_FOR_CORRECTION: [
        "Some findings were returned for correction",
        "توجد ملاحظات أُعيدت للتصحيح",
      ],
      STALE_REVIEW_EVIDENCE: [
        "Some findings no longer match current live values",
        "بعض الملاحظات لم تعد مطابقة للقيم الحية الحالية",
      ],
    };
    const found = labels[code];
    return found ? tr(found[0], found[1]) : code;
  };

  return <section className="table-card no-print">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Whole-bundle governance assessment (no approval)",
          "تقييم حوكمة ملف الإعدادات كاملاً (دون اعتماد)")}</h2>
        <p className="muted">{tr(
          "Checks all authorized source rows against current lab settings and review evidence. Reports counts only, never clinical values or prices. Final clinical and financial activation remains blocked by policy.",
          "يفحص جميع صفوف المصدر المصرّح بها مع الإعدادات الحية وأدلة المراجعة، ويعرض أعداداً فقط دون قيم طبية أو أسعار. التفعيل النهائي الطبي والمالي ما زال محظوراً وفق السياسة.",
        )}</p>
      </div>
      <button type="button" className="secondary-button"
        onClick={() => void inspect()} disabled={busy}>
        {busy ? tr("Assessing…", "جارٍ التقييم…")
          : tr("Assess entire bundle", "تقييم الملف بالكامل")}
      </button>
    </div>
    {error && <p role="alert">{tr("Assessment unavailable: ", "تعذّر التقييم: ")}{error}</p>}
    {report && <>
      <p role="status"><strong>{tr("Final approval and activation: BLOCKED",
        "الاعتماد والتفعيل النهائي: محظور")}</strong></p>
      <p className="muted">{tr("Source originally attested:", "توثيق المصدر الأصلي:")}{" "}
        {report.sourceAttested ? tr("Verified at import", "تم التحقق عند الاستيراد")
          : tr("Not verified", "غير متحقق منه")}</p>
      <div className="table-wrap"><table>
        <thead><tr>
          <th>{tr("Scope", "النطاق")}</th>
          <th>{tr("Rows", "صفوف")}</th>
          <th>{tr("Differences", "اختلافات")}</th>
          <th>{tr("Not referred", "لم تُحل")}</th>
          <th>{tr("Pending", "معلقة")}</th>
          <th>{tr("Confirmed finding", "ملاحظة مؤكدة")}</th>
          <th>{tr("Returned", "معادة للتصحيح")}</th>
          <th>{tr("Stale", "قديمة")}</th>
        </tr></thead>
        <tbody>{categories.map(category => {
          const count = report.byCategory[category];
          return <tr key={category}>
            <td>{category === "CLINICAL" ? tr("Clinical", "طبي")
              : category === "FINANCIAL" ? tr("Financial", "مالي")
              : category === "CROSS_DOMAIN" ? tr("Clinical + Financial review", "مراجعة طبية ومالية")
              : tr("Catalog", "دليل الفحوصات")}</td>
            <td>{count.total}</td><td>{count.drifted}</td>
            <td>{count.driftUnflagged}</td><td>{count.pending}</td>
            <td>{count.expertConfirmed}</td><td>{count.returnedForCorrection}</td>
            <td>{count.stale}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p><strong>{tr("Blocking conditions", "أسباب منع الاعتماد")}</strong></p>
      <ul>{report.blockers.map(code => <li key={code}>{blockerName(code)}</li>)}</ul>
      <h3>{tr("Potential independent reviewer capacity (NOT signing authority)",
        "القدرة المحتملة للمراجعين المستقلين (ليست صلاحية توقيع)")}</h3>
      <p className="muted">{tr(
        "Current active staff with existing catalog, clinical or financial management permissions in this branch, excluding the file author. These counts do not establish authorized signatories.",
        "أعداد الموظفين النشطين الذين لديهم حالياً صلاحيات إدارة الدليل أو المديات أو الأسعار ضمن هذا الفرع، مع استبعاد صاحب الملف. هذه الأعداد لا تعني وجود موقّعين رسميين.",
      )}</p>
      <div className="summary-list">
        <div><span>{tr("Potential clinical reviewers", "المراجعون الطبيون المحتملون")}</span>
          <strong>{report.signatoryPlanning.clinicalReviewerCandidates}</strong></div>
        <div><span>{tr("Potential financial reviewers", "المراجعون الماليون المحتملون")}</span>
          <strong>{report.signatoryPlanning.financialReviewerCandidates}</strong></div>
        <div><span>{tr("Qualified for both management domains", "لديهم صلاحيات إدارة المجالين")}</span>
          <strong>{report.signatoryPlanning.crossQualifiedReviewers}</strong></div>
        <div><span>{tr("Two separate potential reviewers available", "إمكانية وجود مراجعين مختلفين")}</span>
          <strong>{report.signatoryPlanning.distinctPairAvailable
            ? tr("Potentially yes", "ممكن مبدئياً") : tr("Not demonstrated", "غير متحقق")}</strong></div>
        <div><span>{tr("Potential reviewers with MFA configured", "مراجعون محتملون مفعّل لديهم MFA")}</span>
          <strong>{report.signatoryPlanning.mfaEnabledPotentialReviewers}</strong></div>
      </div>
      <p><strong>{tr("Unresolved signing policy and segregation prerequisites",
        "متطلبات سياسة التوقيع وفصل المسؤوليات غير المحسومة")}</strong></p>
      <ul>{report.signatoryPlanning.gaps.map(code => <li key={code}>{
        ({
          FORMAL_SIGNATORY_ROLES_NOT_ESTABLISHED: tr(
            "Formal domain-specific clinical and financial signatory roles not established",
            "لم تُحدّد أدوار الموقّعين الرسميين للمجالين الطبي والمالي"),
          SIGNATURE_AUTHENTICATION_POLICY_UNDEFINED: tr(
            "Final signing requires an approved authentication and re-verification policy",
            "التوقيع النهائي يحتاج سياسة معتمدة للتحقق من الهوية وإعادة المصادقة"),
          SIGNATURE_EVIDENCE_AND_VERSIONED_APPLICATION_NOT_IMPLEMENTED: tr(
            "Signature evidence and version-preserving activation not implemented",
            "توثيق التوقيع والتفعيل مع حفظ الإصدارات غير منفّذين"),
          NO_INDEPENDENT_CLINICAL_REVIEW_CANDIDATE: tr(
            "No separate potential clinical reviewer found in this branch",
            "لم يوجد مراجع طبي محتمل مستقل ضمن هذا الفرع"),
          NO_INDEPENDENT_FINANCIAL_REVIEW_CANDIDATE: tr(
            "No separate potential financial reviewer found in this branch",
            "لم يوجد مراجع مالي محتمل مستقل ضمن هذا الفرع"),
          NO_TWO_DISTINCT_CROSS_DOMAIN_REVIEWERS: tr(
            "Distinct clinical and financial reviewers not demonstrated",
            "لم يثبت توافر مراجعين طبي ومالي مختلفين"),
        } as Record<string, string>)[code] || code
      }</li>)}</ul>
      {report.policyReviewFeedback && <div className="table-card">
        <h3>{tr("Independent reviewer feedback — NOT approval",
          "ملاحظات المراجعين المستقلين — ليست اعتماداً")}</h3>
        <p className="muted">{tr(
          "These outcomes apply only to the currently recorded unsigned draft revision. Older reviewer comments never carry forward as approval.",
          "هذه الملاحظات تخص النسخة الحالية فقط من المسودة غير الموقّعة. المراجعات القديمة لا تنتقل إلى النسخة الجديدة كاعتماد.",
        )} ({tr("Revision", "النسخة")} {report.policyReviewFeedback.revision})</p>
        <div className="table-wrap"><table>
          <thead><tr><th>{tr("Review domain", "مجال المراجعة")}</th>
            <th>{tr("Procedural status", "الحالة التنظيمية")}</th>
            <th>{tr("Review comment", "ملاحظة المراجعة")}</th></tr></thead>
          <tbody>{(["CLINICAL", "FINANCIAL"] as const).map(domain => {
            const feedback = report.policyReviewFeedback!.domains[domain];
            return <tr key={domain}>
              <td>{domain === "CLINICAL" ? tr("Clinical", "طبي") : tr("Financial", "مالي")}</td>
              <td>{feedback.status === "PENDING" ? tr("Awaiting review", "بانتظار المراجعة")
                : feedback.status === "RETURN_FOR_REVISION" ? tr("Returned for revision", "أعيد للتعديل")
                : tr("Noted for discussion — NOT approval", "سُجّل للنقاش — ليس اعتماداً")}</td>
              <td>{feedback.reasonCode ? reviewReason(feedback.reasonCode) : "—"}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </div>}
      <CatalogPolicyDraftEditor
        key={report.policyDraft?.revision || 0}
        batchId={batchId} locale={locale} savedDraft={report.policyDraft}
        onSaved={draft => setReport(previous => previous
          ? { ...previous, policyDraft: draft,
              policyReviewFeedback: previous.policyReviewFeedback &&
                previous.policyReviewFeedback.revision === draft.revision
                ? previous.policyReviewFeedback : {
                  revision: draft.revision,
                  domains: {
                    CLINICAL: { status: "PENDING", reasonCode: null },
                    FINANCIAL: { status: "PENDING", reasonCode: null },
                  },
                  reviewOnly: true, approved: false, signingEnabled: false,
                  activated: false, liveWrites: false,
                },
            } : previous)}
      />
      <p className="muted">{tr(
        "Confirming a discrepancy only acknowledges that a finding exists. It never authorizes changing laboratory reference intervals, catalog content or prices.",
        "تأكيد الاختلاف يعني الإقرار بوجود ملاحظة فقط، ولا يجيز تعديل المديات المرجعية أو دليل الفحوصات أو الأسعار.",
      )}</p>
    </>}
  </section>;
}
