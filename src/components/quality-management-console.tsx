"use client";

import { SystemDateField } from "@/components/system-date-field";
import { SystemDateText } from "@/components/system-date-text";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { statusLabel as sharedStatusLabel } from "@/lib/ui-i18n";

type Branch = { id: string; code: string; nameEn: string; nameAr?: string | null };
type UserOption = { id: string; username: string; displayNameEn: string; displayNameAr?: string | null };
type Analyzer = { id: string; code: string; name: string; branchId: string };
type PermissionFlags = {
  nonconformance: boolean;
  capa: boolean;
  documents: boolean;
  training: boolean;
  indicators: boolean;
  audits: boolean;
};

type Nonconformance = {
  id: string;
  caseNumber: string;
  title: string;
  category: string;
  severity: string;
  status: string;
  branch: string;
  detectedAt: string;
  owner: string | null;
  rootCause: string | null;
  closureSummary: string | null;
  capas: Array<{ id: string; capaNumber: string; status: string }>;
};

type Capa = {
  id: string;
  capaNumber: string;
  title: string;
  status: string;
  branch: string;
  owner: string;
  dueDate: string | null;
  effectiveness: string;
  nonconformanceCase: string | null;
  actions: Array<{
    id: string;
    actionType: string;
    description: string;
    status: string;
    owner: string | null;
    dueDate: string | null;
  }>;
};

type QualityDocument = {
  id: string;
  code: string;
  titleEn: string;
  titleAr: string | null;
  documentType: string;
  branch: string;
  currentEffectiveVersion: number;
  versions: Array<{
    id: string;
    version: number;
    status: string;
    changeSummary: string | null;
    effectiveFrom: string | null;
    reviewDueAt: string | null;
    externalUrl: string | null;
  }>;
};

type TrainingRecord = {
  id: string;
  user: string;
  title: string;
  status: string;
  analyzer: string | null;
  document: string | null;
  assignedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
};

type Competency = {
  id: string;
  user: string;
  competencyName: string;
  result: string;
  analyzer: string | null;
  assessedAt: string;
  nextDueAt: string | null;
  assessor: string;
};

type Authorization = {
  id: string;
  user: string;
  analyzer: string;
  status: string;
  authorizedAt: string;
  expiresAt: string | null;
  approvedBy: string;
};

type Indicator = {
  id: string;
  code: string;
  nameEn: string;
  nameAr?: string | null;
  branch: string;
  direction: string;
  unit: string | null;
  targetMin: string | null;
  targetMax: string | null;
  measurements: Array<{ id: string; periodStart: string; periodEnd: string; value: string }>;
};

type InternalAudit = {
  id: string;
  auditNumber: string;
  title: string;
  scope: string;
  status: string;
  branch: string;
  scheduledAt: string;
  leadAuditor: string;
  findings: Array<{
    id: string;
    findingNumber: string;
    severity: string;
    description: string;
    status: string;
    owner: string | null;
    dueDate: string | null;
    capaNumber: string | null;
  }>;
};

export function QualityManagementConsole({
  permissions,
  branches,
  users,
  analyzers,
  nonconformances,
  capas,
  documents,
  trainingRecords,
  competencies,
  authorizations,
  effectiveDocumentVersions,
  indicators,
  audits,
  locale,
}: {
  permissions: PermissionFlags;
  branches: Branch[];
  users: UserOption[];
  analyzers: Analyzer[];
  nonconformances: Nonconformance[];
  capas: Capa[];
  documents: QualityDocument[];
  trainingRecords: TrainingRecord[];
  competencies: Competency[];
  authorizations: Authorization[];
  effectiveDocumentVersions: Array<{ id: string; label: string }>;
  indicators: Indicator[];
  audits: InternalAudit[];
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const submitting = useRef(false);
  const [isError, setIsError] = useState(false);
  const [message, setMessage] = useState("");
  const [uiEditor, setUiEditor] = useState("");
  type ReviewKind = "NC_STATUS" | "CAPA_ACTION_CREATE" | "CAPA_ACTION_COMPLETE" |
    "CAPA_EFFECTIVENESS" | "DOCUMENT_VERSION_CREATE" | "DOCUMENT_WORKFLOW" |
    "ANALYZER_REVOKE" | "INDICATOR_MEASUREMENT" | "AUDIT_FINDING_CREATE" |
    "AUDIT_FINDING_CLOSE" | "AUDIT_COMPLETE";
  type PendingReview = { kind: ReviewKind; id: string; subId?: string;
    operation?: string; close?: boolean; rootCause?: string;
    closureSummary?: string; unit?: string };
  const [pendingReview, setPendingReview] = useState<PendingReview | null>(null);
  const [reviewSeverity, setReviewSeverity] = useState("MINOR");
  const [reviewEffectiveness, setReviewEffectiveness] = useState("EFFECTIVE");
  const [reviewError, setReviewError] = useState("");
  function openReview(data: PendingReview) {
    if (busy) return;
    setMessage("");
    setReviewError("");
    setReviewSeverity("MINOR");
    setReviewEffectiveness("EFFECTIVE");
    setPendingReview(data);
  }

  const [trainingAnalyzerId, setTrainingAnalyzerId] = useState("");
  const [competencyAnalyzerId, setCompetencyAnalyzerId] = useState("");
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const branchName = (item: Branch) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const userName = (item: UserOption) => locale === "ar" ? item.displayNameAr || item.displayNameEn : item.displayNameEn;
  const qmsStatusLabel = (value: string) => {
    const labels: Record<string, [string, string]> = {
      OPEN: ["Open", "مفتوح"],
      INVESTIGATING: ["Investigating", "قيد التحقيق"],
      ACTION_REQUIRED: ["Action required", "إجراء مطلوب"],
      EFFECTIVENESS_REVIEW: ["Effectiveness review", "مراجعة الفعالية"],
      CLOSED: ["Closed", "مغلق"],
      CANCELLED: ["Cancelled", "ملغى"],
      DRAFT: ["Draft", "مسودة"],
      IN_REVIEW: ["In review", "قيد المراجعة"],
      REVIEWED: ["Reviewed", "تمت المراجعة"],
      APPROVED: ["Approved", "معتمد"],
      EFFECTIVE: ["Effective", "ساري"],
      RETIRED: ["Retired", "متقاعد"],
      ASSIGNED: ["Assigned", "معين"],
      IN_PROGRESS: ["In progress", "قيد التنفيذ"],
      COMPLETED: ["Completed", "مكتمل"],
      WAIVED: ["Waived", "معفى"],
      EXPIRED: ["Expired", "منتهي"],
      ACTIVE: ["Active", "نشط"],
      SUSPENDED: ["Suspended", "موقوف"],
      REVOKED: ["Revoked", "ملغى"],
      PLANNED: ["Planned", "مخطط"],
    };
    const label = labels[value];
    return label ? tr(label[0], label[1]) : sharedStatusLabel(locale, value);
  };
  const severityLabel = (value: string) =>
    value === "OBSERVATION" ? tr("Observation", "ملاحظة") :
    value === "MINOR" ? tr("Minor", "طفيفة") :
    value === "MAJOR" ? tr("Major", "جسيمة") :
    value === "CRITICAL" ? tr("Critical", "حرجة") : value;
  const actionTypeLabel = (value: string) =>
    value === "CORRECTIVE" ? tr("Corrective", "تصحيحي") :
    value === "PREVENTIVE" ? tr("Preventive", "وقائي") : value;
  const effectivenessLabel = (value: string) =>
    value === "UNKNOWN" ? tr("Not reviewed", "لم تُراجع") :
    value === "EFFECTIVE" ? tr("Effective", "فعّال") :
    value === "PARTIALLY_EFFECTIVE" ? tr("Partially effective", "فعّال جزئياً") :
    value === "INEFFECTIVE" ? tr("Ineffective", "غير فعّال") : value;
  const directionLabel = (value: string) =>
    value === "LOWER_IS_BETTER" ? tr("Lower is better", "الأقل أفضل") :
    value === "HIGHER_IS_BETTER" ? tr("Higher is better", "الأعلى أفضل") :
    value === "TARGET_RANGE" ? tr("Target range", "نطاق مستهدف") : value;
  const competencyResultLabel = (value: string) =>
    value === "PASS" ? tr("Pass", "ناجح") :
    value === "CONDITIONAL" ? tr("Conditional", "مشروط") :
    value === "FAIL" ? tr("Fail", "فشل") : value;
  const documentTypeLabel = (value: string) =>
    value === "POLICY" ? tr("Policy", "سياسة") :
    value === "WORK_INSTRUCTION" ? tr("Work instruction", "تعليمات عمل") :
    value === "FORM" ? tr("Form", "نموذج") :
    value === "CHECKLIST" ? tr("Checklist", "قائمة تحقق") :
    value === "OTHER" ? tr("Other", "أخرى") :
    value;

  const openNonconformances = useMemo(
    () => nonconformances.filter(item => !["CLOSED","CANCELLED"].includes(item.status)),
    [nonconformances],
  );
  const openCapas = useMemo(
    () => capas.filter(item => !["CLOSED","CANCELLED"].includes(item.status)),
    [capas],
  );

  async function send(url: string, method: "POST" | "PATCH", payload: unknown, key: string, success: string) {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(key);
    setIsError(false);
    setMessage("");
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      const reason = body.error || "";
    const errorMessages: Record<string, string> = {
      open_capa_actions: tr("Finish all CAPA actions before review.", "أكمل إجراءات CAPA المفتوحة قبل المراجعة."),
      completed_capa_action_required: tr("At least one completed CAPA action is required before closure.", "يجب إكمال إجراء تصحيحي أو وقائي واحد على الأقل قبل الإغلاق."),
      capa_review_conflict_or_locked: tr("CAPA changed or was closed by another operator. Refresh and review.", "تغيّرت حالة CAPA أو أُغلقت بواسطة مستخدم آخر. حدّث الصفحة وراجع الحالة."),
      capa_action_conflict_or_locked: tr("The CAPA action changed or its case is closed.", "تغيّر الإجراء أو أُغلق ملف CAPA."),
      open_capa_blocks_nonconformance_closure: tr("Close linked CAPA records before closing the nonconformance.", "أغلق ملفات CAPA المرتبطة قبل إغلاق عدم المطابقة."),
      capa_nonconformance_branch_mismatch: tr("CAPA and nonconformance must share the same branch.", "يجب أن يتطابق فرع CAPA مع فرع حالة عدم المطابقة."),
      capa_nonconformance_state_conflict: tr("The nonconformance changed or is closed. Refresh and review.", "تغيّرت حالة عدم المطابقة أو أُغلقت. حدّث الصفحة وراجع الحالة."),
      nonconformance_state_conflict: tr("Nonconformance changed. Refresh and review.", "تغيّرت حالة عدم المطابقة. حدّث الصفحة وراجع الحالة."),
      open_audit_findings: tr("Close all audit findings before completing the audit.", "يجب إغلاق جميع ملاحظات التدقيق قبل إنهائه."),
      audit_completion_conflict: tr("Audit state changed. Refresh and review.", "تغيّرت حالة التدقيق. حدّث الصفحة وراجع الحالة."),
      audit_finding_creation_conflict: tr("Audit is already closed or being updated.", "التدقيق مغلق أو تجري عليه عملية أخرى."),
      audit_finding_closure_conflict: tr("Audit finding changed or the audit is closed.", "تغيّرت الملاحظة أو أُغلق التدقيق."),
      linked_capa_must_be_closed: tr("Close the linked CAPA before this audit finding.", "أغلق CAPA المرتبط قبل إغلاق ملاحظة التدقيق."),
      document_workflow_state_conflict: tr("Document version changed. Refresh before retrying.", "تغيّرت حالة إصدار الوثيقة. حدّث الصفحة قبل إعادة المحاولة."),
      older_version_cannot_replace_effective: tr("An older SOP version cannot replace a newer effective version.", "لا يمكن لإصدار أقدم من إجراء العمل أن يحل محل إصدار أحدث نافذ."),
    };
      if (!response.ok) {
        setIsError(true);
        setMessage(errorMessages[reason] ||
          tr("Action failed. Refresh and review the record.", "فشلت العملية. حدّث الصفحة وراجع السجل."));
        return false;
      }
      setMessage(success);
      router.refresh();
      return true;
    } catch {
      setIsError(true);
      setMessage(tr("Connection interrupted. Review the latest audited state before retrying.",
        "انقطع الاتصال. راجع آخر حالة مدققة قبل إعادة المحاولة."));
      return false;
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  const reviewLabel = (kind: ReviewKind) => ({
    NC_STATUS: tr("Review Nonconformance Status", "مراجعة حالة عدم المطابقة"),
    CAPA_ACTION_CREATE: tr("Add Corrective / Preventive Action", "إضافة إجراء تصحيحي أو وقائي"),
    CAPA_ACTION_COMPLETE: tr("Confirm CAPA Action Completion", "تأكيد إكمال إجراء CAPA"),
    CAPA_EFFECTIVENESS: tr("Independent CAPA Effectiveness Review", "مراجعة فعالية CAPA المستقلة"),
    DOCUMENT_VERSION_CREATE: tr("Create Controlled Document Version", "إنشاء إصدار وثيقة مضبوطة"),
    DOCUMENT_WORKFLOW: tr("Confirm Document Workflow Decision", "تأكيد قرار حوكمة الوثيقة"),
    ANALYZER_REVOKE: tr("Revoke Equipment Authorization", "إلغاء صلاحية تشغيل جهاز"),
    INDICATOR_MEASUREMENT: tr("Add Quality Indicator Measurement", "تسجيل قياس مؤشر جودة"),
    AUDIT_FINDING_CREATE: tr("Record Internal Audit Finding", "تسجيل ملاحظة تدقيق داخلي"),
    AUDIT_FINDING_CLOSE: tr("Close Internal Audit Finding", "إغلاق ملاحظة تدقيق داخلي"),
    AUDIT_COMPLETE: tr("Complete Internal Audit", "إكمال التدقيق الداخلي"),
  }[kind]);

  async function confirmQualityReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const review = pendingReview;
    if (!review || busy) return;
    setReviewError("");
    const fields = new FormData(event.currentTarget);
    const field = (key: string) => String(fields.get(key) || "").trim();
    const action = review.kind;
    let url = "";
    let method: "POST" | "PATCH" = "POST";
    let payload: Record<string, unknown> = {};
    let key = "quality-review-" + review.id;
    if (action === "NC_STATUS") {
      url = "/api/quality/nonconformances/" + review.id;
      method = "PATCH";
      const rootCause = review.close ? field("rootCause") : review.rootCause || "";
      const closureSummary = review.close ? field("closureSummary") : review.closureSummary || "";
      if (review.close && (!rootCause || !closureSummary)) {
        setReviewError(tr("Root cause and closure summary are required.", "السبب الجذري وملخص الإغلاق إلزاميان."));
        return;
      }
      payload = {status: review.close ? "CLOSED" : "INVESTIGATING", rootCause, closureSummary};
      key = "nc-" + review.id;
    } else if (action === "CAPA_ACTION_CREATE") {
      url = "/api/quality/capas/" + review.id + "/actions";
      payload = {actionType: field("actionType"), description: field("description"),
        dueDate: field("dueDate")};
      key = "capa-action-" + review.id;
    } else if (action === "CAPA_ACTION_COMPLETE") {
      url = "/api/quality/capas/" + review.id + "/actions";
      method = "PATCH";
      payload = {actionId: review.subId, status: "COMPLETED"};
      key = "capa-action-" + review.subId;
    } else if (action === "CAPA_EFFECTIVENESS") {
      url = "/api/quality/capas/" + review.id + "/review";
      const effectiveness = field("effectiveness");
      const close = effectiveness === "EFFECTIVE" && fields.get("close") === "on";
      payload = {effectiveness, effectivenessReview: field("effectivenessReview"), close};
      key = "capa-review-" + review.id;
    } else if (action === "DOCUMENT_VERSION_CREATE") {
      const changeSummary = field("changeSummary");
      const content = field("content");
      const externalUrl = field("externalUrl");
      if (!changeSummary || (!content && !externalUrl) || (content && externalUrl)) {
        setReviewError(tr("Add a change summary and either document text or an external URL.",
          "أدخل ملخص التغيير ونص الوثيقة أو رابطاً خارجياً واحداً."));
        return;
      }
      url = "/api/quality/documents/" + review.id + "/versions";
      payload = {changeSummary, contentSnapshot: content ? {text: content} : null, externalUrl};
      key = "doc-new-" + review.id;
    } else if (action === "DOCUMENT_WORKFLOW") {
      if (!["SUBMIT_REVIEW", "COMPLETE_REVIEW", "APPROVE", "MAKE_EFFECTIVE"].includes(review.operation || "")) return;
      url = "/api/quality/document-versions/" + review.id + "/workflow";
      payload = {action: review.operation};
      key = "doc-workflow-" + review.id;
    } else if (action === "ANALYZER_REVOKE") {
      const reason = field("reason");
      if (!reason) {setReviewError(tr("A revocation reason is required.", "سبب الإلغاء إلزامي.")); return;}
      url = "/api/quality/analyzer-authorizations";
      method = "PATCH";
      payload = {id: review.id, status: "REVOKED", revocationReason: reason};
      key = "auth-" + review.id;
    } else if (action === "INDICATOR_MEASUREMENT") {
      url = "/api/quality/indicators/" + review.id + "/measurements";
      payload = {periodStart: field("periodStart"), periodEnd: field("periodEnd"),
        value: field("value"), numerator: field("numerator"), denominator: field("denominator")};
      key = "indicator-measure-" + review.id;
    } else if (action === "AUDIT_FINDING_CREATE") {
      const severity = field("severity");
      const capaId = field("capaId");
      if (severity === "CRITICAL" && !capaId) {
        setReviewError(tr("A critical audit finding must link an existing open CAPA.",
          "الملاحظة الحرجة يجب ربطها بملف CAPA مفتوح."));
        return;
      }
      if (capaId && !openCapas.some(item => item.id === capaId)) {
        setReviewError(tr("The selected CAPA is no longer open.", "لم يعد ملف CAPA المحدد مفتوحاً."));
        return;
      }
      url = "/api/quality/audits/" + review.id + "/findings";
      payload = {severity, description: field("description"), requirementRef: field("requirementRef"), capaId};
      key = "finding-create-" + review.id;
    } else if (action === "AUDIT_FINDING_CLOSE") {
      url = "/api/quality/audits/" + review.id + "/findings";
      method = "PATCH";
      payload = {findingId: review.subId, closureNote: field("closureNote")};
      key = "finding-close-" + review.subId;
    } else if (action === "AUDIT_COMPLETE") {
      url = "/api/quality/audits/" + review.id + "/complete";
      payload = {summary: field("summary")};
      key = "audit-complete-" + review.id;
    }
    if (!url) return;
    const ok = await send(url, method, payload, key,
      tr("Governed quality action saved and audited.", "تم حفظ إجراء الجودة وتوثيقه."));
    if (ok) setPendingReview(null);
  }

  async function createNonconformance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await send("/api/quality/nonconformances", "POST", {
      branchId: form.get("branchId"),
      title: form.get("title"),
      description: form.get("description"),
      category: form.get("category"),
      severity: form.get("severity"),
      occurredAt: form.get("occurredAt"),
      ownerUserId: form.get("ownerUserId"),
      immediateAction: form.get("immediateAction"),
      sourceEntityType: form.get("sourceEntityType"),
      sourceEntityId: form.get("sourceEntityId"),
    }, "nc-create", tr("Nonconformance recorded.", "تم تسجيل حالة عدم المطابقة."));
    if (ok) formElement.reset();
  }

  function updateNonconformance(item: Nonconformance, close: boolean) {
    openReview({kind: "NC_STATUS", id: item.id, close,
      rootCause: item.rootCause || "", closureSummary: item.closureSummary || ""});
  }

  async function createCapa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await send("/api/quality/capas", "POST", {
      branchId: form.get("branchId"),
      nonconformanceId: form.get("nonconformanceId"),
      title: form.get("title"),
      issueDescription: form.get("issueDescription"),
      rootCause: form.get("rootCause"),
      ownerUserId: form.get("ownerUserId"),
      dueDate: form.get("dueDate"),
    }, "capa-create", tr("CAPA created.", "تم إنشاء CAPA."));
    if (ok) formElement.reset();
  }

  function addCapaAction(capa: Capa) {
    openReview({kind: "CAPA_ACTION_CREATE", id: capa.id});
  }

  function completeCapaAction(capaId: string, actionId: string) {
    openReview({kind: "CAPA_ACTION_COMPLETE", id: capaId, subId: actionId});
  }

  function reviewCapa(capa: Capa) {
    openReview({kind: "CAPA_EFFECTIVENESS", id: capa.id});
  }

  async function createDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const content = String(form.get("content") || "").trim();
    const ok = await send("/api/quality/documents", "POST", {
      branchId: form.get("branchId"),
      code: form.get("code"),
      titleEn: form.get("titleEn"),
      titleAr: form.get("titleAr"),
      documentType: form.get("documentType"),
      ownerUserId: form.get("ownerUserId"),
      externalUrl: form.get("externalUrl"),
      reviewDueAt: form.get("reviewDueAt"),
      contentSnapshot: content ? { text: content } : null,
      changeSummary: "Initial version",
    }, "document-create", tr("Controlled document created as version 1 draft.", "تم إنشاء الوثيقة المضبوطة كمسودة إصدار 1."));
    if (ok) formElement.reset();
  }

  function newDocumentVersion(document: QualityDocument) {
    openReview({kind: "DOCUMENT_VERSION_CREATE", id: document.id});
  }

  function documentWorkflow(versionId: string, action: "SUBMIT_REVIEW" | "COMPLETE_REVIEW" | "APPROVE" | "MAKE_EFFECTIVE") {
    openReview({kind: "DOCUMENT_WORKFLOW", id: versionId, operation: action});
  }

  async function createTraining(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await send("/api/quality/training", "POST", {
      branchId: form.get("branchId"),
      userId: form.get("userId"),
      title: form.get("title"),
      provider: form.get("provider"),
      documentVersionId: form.get("documentVersionId"),
      analyzerId: form.get("analyzerId"),
      status: form.get("status"),
      assignedAt: form.get("assignedAt"),
      completedAt: form.get("completedAt"),
      expiresAt: form.get("expiresAt"),
      certificateUrl: form.get("certificateUrl"),
      notes: form.get("notes"),
    }, "training-create", tr("Training record saved.", "تم حفظ سجل التدريب."));
    if (ok) {
      formElement.reset();
      setTrainingAnalyzerId("");
    }
  }

  async function createCompetency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await send("/api/quality/competency", "POST", {
      branchId: form.get("branchId"),
      userId: form.get("userId"),
      analyzerId: form.get("analyzerId"),
      documentVersionId: form.get("documentVersionId"),
      competencyName: form.get("competencyName"),
      assessmentMethod: form.get("assessmentMethod"),
      result: form.get("result"),
      assessedAt: form.get("assessedAt"),
      nextDueAt: form.get("nextDueAt"),
      notes: form.get("notes"),
    }, "competency-create", tr("Competency assessment recorded.", "تم تسجيل تقييم الكفاءة."));
    if (ok) {
      formElement.reset();
      setCompetencyAnalyzerId("");
    }
  }

  async function grantAuthorization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await send("/api/quality/analyzer-authorizations", "POST", {
      userId: form.get("userId"),
      analyzerId: form.get("analyzerId"),
      expiresAt: form.get("expiresAt"),
      scopeNotes: form.get("scopeNotes"),
    }, "authorization-create", tr("Analyzer authorization granted.", "تم منح صلاحية استخدام الجهاز."));
    if (ok) formElement.reset();
  }

  function revokeAuthorization(item: Authorization) {
    openReview({kind: "ANALYZER_REVOKE", id: item.id});
  }

  async function createIndicator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await send("/api/quality/indicators", "POST", {
      branchId: form.get("branchId"),
      code: form.get("code"),
      nameEn: form.get("nameEn"),
      nameAr: form.get("nameAr"),
      unit: form.get("unit"),
      direction: form.get("direction"),
      targetMin: form.get("targetMin"),
      targetMax: form.get("targetMax"),
      description: form.get("description"),
    }, "indicator-create", tr("Quality indicator created.", "تم إنشاء مؤشر الجودة."));
    if (ok) formElement.reset();
  }

  function addMeasurement(indicator: Indicator) {
    openReview({kind: "INDICATOR_MEASUREMENT", id: indicator.id, unit: indicator.unit || ""});
  }

  async function createAudit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await send("/api/quality/audits", "POST", {
      branchId: form.get("branchId"),
      title: form.get("title"),
      scope: form.get("scope"),
      scheduledAt: form.get("scheduledAt"),
      leadAuditorUserId: form.get("leadAuditorUserId"),
    }, "audit-create", tr("Internal audit planned.", "تم تخطيط التدقيق الداخلي."));
    if (ok) formElement.reset();
  }

  function addFinding(audit: InternalAudit) {
    openReview({kind: "AUDIT_FINDING_CREATE", id: audit.id});
  }

  function closeFinding(auditId: string, findingId: string) {
    openReview({kind: "AUDIT_FINDING_CLOSE", id: auditId, subId: findingId});
  }

  function completeAudit(audit: InternalAudit) {
    openReview({kind: "AUDIT_COMPLETE", id: audit.id});
  }

  return <div className="detail-section">
    {message && <div className={isError ? "form-error" : "form-success"} role={isError ? "alert" : "status"}>{message}</div>}

    {permissions.nonconformance && <section className="detail-card detail-section">
      <h2>{tr("Record Nonconformance","تسجيل حالة عدم مطابقة")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
   onClick={() => { setMessage(""); setUiEditor("nonconformance"); }}>{tr("Record Nonconformance", "تسجيل عدم مطابقة")}</button>
   <CrudModal open={uiEditor === "nonconformance"} onClose={() => { if (!submitting.current && !busy) setUiEditor(""); }}
     size="compact" title={tr("Record Nonconformance", "تسجيل عدم مطابقة")}
     description={tr("Record documented quality events and preserve their immutable investigation history.", "سجّل حدث الجودة الموثق مع الحفاظ على تاريخ التحقيق.")}>
     {uiEditor === "nonconformance" && <form className="catalog-form" onSubmit={createNonconformance}>
        <label>{tr("Branch","الفرع")}<select name="branchId" defaultValue=""><option value="">{tr("Organization-wide","على مستوى المؤسسة")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branchName(branch)}</option>)}</select></label>
        <label>{tr("Severity","الشدة")}<select name="severity" defaultValue="MINOR"><option value="MINOR">{severityLabel("MINOR")}</option><option value="MAJOR">{severityLabel("MAJOR")}</option><option value="CRITICAL">{severityLabel("CRITICAL")}</option></select></label>
        <label>{tr("Category","الفئة")}<input name="category" required placeholder={tr("Pre-analytical / Analytical / Post-analytical / Safety…","قبل التحليل / أثناء التحليل / بعد التحليل / السلامة…")} /></label>
        <label>{tr("Owner","المسؤول")}<select name="ownerUserId" defaultValue=""><option value="">{tr("Unassigned","غير معين")}</option>{users.map(user => <option key={user.id} value={user.id}>{userName(user)}</option>)}</select></label>
        <label className="form-span">{tr("Title","العنوان")}<input name="title" required /></label>
        <label className="form-span">{tr("Description","الوصف")}<textarea name="description" rows={3} required /></label>
        <label>{tr("Occurred at","وقت الحدوث")}<input name="occurredAt" type="datetime-local" /></label>
        <label>{tr("Source type","نوع المصدر")}<input name="sourceEntityType" placeholder={tr("Specimen / Result / Equipment…","عينة / نتيجة / معدة…")} /></label>
        <label>{tr("Source ID","معرّف المصدر")}<input name="sourceEntityId" /></label>
        <label className="form-span">{tr("Immediate action","الإجراء الفوري")}<textarea name="immediateAction" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "nc-create" ? tr("Saving…","جارٍ الحفظ…") : tr("Record Nonconformance","تسجيل حالة عدم المطابقة")}</button>
      </form>}
     {uiEditor === "nonconformance" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr("Nonconformance Register","سجل عدم المطابقة")}</h2><span>{nonconformances.length} {tr("shown","معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Case","الحالة")}</th><th>{tr("Title","العنوان")}</th><th>{tr("Branch","الفرع")}</th><th>{tr("Severity","الشدة")}</th><th>{tr("Status","الحالة")}</th><th>{tr("Owner","المسؤول")}</th><th>{tr("Detected","تاريخ الاكتشاف")}</th><th>CAPA</th><th>{tr("Actions","الإجراءات")}</th></tr></thead>
        <tbody>{nonconformances.length === 0 ? <tr><td colSpan={9} className="empty-state">{tr("No nonconformances recorded.","لا توجد حالات عدم مطابقة مسجلة.")}</td></tr> : nonconformances.map(item => <tr key={item.id}>
          <td><strong>{item.caseNumber}</strong><br/><small>{item.category}</small></td>
          <td>{item.title}</td><td>{item.branch}</td><td>{severityLabel(item.severity)}</td><td>{qmsStatusLabel(item.status)}</td><td>{item.owner || "—"}</td>
          <td>{item.detectedAt.replace("T"," ").slice(0,16)}</td>
          <td>{item.capas.map(capa => capa.capaNumber).join(", ") || "—"}</td>
          <td>{permissions.nonconformance && !["CLOSED","CANCELLED"].includes(item.status) && <div className="result-actions">
            <button type="button" className="secondary-button" disabled={busy !== ""} onClick={() => void updateNonconformance(item,false)}>{tr("Investigate","بدء التحقيق")}</button>
            <button type="button" className="secondary-button" disabled={busy !== ""} onClick={() => void updateNonconformance(item,true)}>{tr("Close","إغلاق")}</button>
          </div>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {permissions.capa && <section className="detail-card detail-section">
      <h2>{tr("Create CAPA","إنشاء CAPA")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
   onClick={() => { setMessage(""); setUiEditor("capa"); }}>{tr("Create CAPA", "إنشاء إجراء تصحيحي ووقائي")}</button>
   <CrudModal open={uiEditor === "capa"} onClose={() => { if (!submitting.current && !busy) setUiEditor(""); }}
     size="compact" title={tr("Create CAPA", "إنشاء إجراء تصحيحي ووقائي")}
     description={tr("Corrective and preventive actions require governed owners, deadlines and follow-up.", "تتطلب الإجراءات التصحيحية والوقائية مسؤولاً ومهلاً ومتابعة موثقة.")}>
     {uiEditor === "capa" && <form className="catalog-form" onSubmit={createCapa}>
        <label>{tr("Branch","الفرع")}<select name="branchId" defaultValue=""><option value="">{tr("Organization-wide","على مستوى المؤسسة")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branchName(branch)}</option>)}</select></label>
        <label>{tr("Linked nonconformance","عدم المطابقة المرتبط")}<select name="nonconformanceId" defaultValue=""><option value="">{tr("None","لا يوجد")}</option>{openNonconformances.map(item => <option key={item.id} value={item.id}>{item.caseNumber} — {item.title}</option>)}</select></label>
        <label>{tr("Owner","المسؤول")}<select name="ownerUserId" required defaultValue=""><option value="">{tr("Select owner…","اختر المسؤول…")}</option>{users.map(user => <option key={user.id} value={user.id}>{userName(user)}</option>)}</select></label>
        <label>{tr("Due date","تاريخ الاستحقاق")}<SystemDateField name="dueDate" /></label>
        <label className="form-span">{tr("Title","العنوان")}<input name="title" required /></label>
        <label className="form-span">{tr("Issue description","وصف المشكلة")}<textarea name="issueDescription" rows={3} required /></label>
        <label className="form-span">{tr("Root cause","السبب الجذري")}<textarea name="rootCause" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "capa-create" ? tr("Saving…","جارٍ الحفظ…") : tr("Create CAPA","إنشاء CAPA")}</button>
      </form>}
     {uiEditor === "capa" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr("CAPA Register","سجل CAPA")}</h2><span>{capas.length} {tr("shown","معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>CAPA</th><th>{tr("Title","العنوان")}</th><th>{tr("Owner","المسؤول")}</th><th>{tr("Status","الحالة")}</th><th>{tr("Due","الاستحقاق")}</th><th>{tr("Effectiveness","الفعالية")}</th><th>{tr("Actions","الإجراءات")}</th><th>{tr("Controls","التحكم")}</th></tr></thead>
        <tbody>{capas.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr("No CAPA records.","لا توجد سجلات CAPA.")}</td></tr> : capas.map(item => <tr key={item.id}>
          <td><strong>{item.capaNumber}</strong>{item.nonconformanceCase && <><br/><small>{item.nonconformanceCase}</small></>}</td>
          <td>{item.title}<br/><small>{item.branch}</small></td><td>{item.owner}</td><td>{qmsStatusLabel(item.status)}</td><td>{item.dueDate ? <SystemDateText value={item.dueDate} kind="calendar-record" /> : "—"}</td><td>{effectivenessLabel(item.effectiveness)}</td>
          <td>{item.actions.length === 0 ? "—" : item.actions.map(action => <div key={action.id}><small>{actionTypeLabel(action.actionType)} · {qmsStatusLabel(action.status)} · {action.description}</small>{permissions.capa && action.status !== "COMPLETED" && action.status !== "CANCELLED" && <button type="button" className="table-action" onClick={() => void completeCapaAction(item.id,action.id)}>{tr("Complete","إكمال")}</button>}</div>)}</td>
          <td>{permissions.capa && !["CLOSED","CANCELLED"].includes(item.status) && <div className="result-actions"><button type="button" className="secondary-button" onClick={() => void addCapaAction(item)}>{tr("Add Action","إضافة إجراء")}</button><button type="button" className="secondary-button" onClick={() => void reviewCapa(item)}>{tr("Review","مراجعة")}</button></div>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {permissions.documents && <section className="detail-card detail-section">
      <h2>{tr("Create Controlled Document","إنشاء وثيقة مضبوطة")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
   onClick={() => { setMessage(""); setUiEditor("document"); }}>{tr("Create Controlled Document", "إنشاء وثيقة مضبوطة")}</button>
   <CrudModal open={uiEditor === "document"} onClose={() => { if (!submitting.current && !busy) setUiEditor(""); }}
     size="compact" title={tr("Create Controlled Document", "إنشاء وثيقة مضبوطة")}
     description={tr("Controlled documents require explicit versioning and independent approval.", "تحتاج الوثائق المضبوطة إلى إصدارات واعتماد مستقل.")}>
     {uiEditor === "document" && <form className="catalog-form" onSubmit={createDocument}>
        <label>{tr("Code","الرمز")}<input name="code" required placeholder="SOP-HEM-001" /></label>
        <label>{tr("Type","النوع")}<select name="documentType" defaultValue="SOP"><option value="SOP">SOP</option><option value="POLICY">{documentTypeLabel("POLICY")}</option><option value="WORK_INSTRUCTION">{documentTypeLabel("WORK_INSTRUCTION")}</option><option value="FORM">{documentTypeLabel("FORM")}</option><option value="CHECKLIST">{documentTypeLabel("CHECKLIST")}</option><option value="OTHER">{documentTypeLabel("OTHER")}</option></select></label>
        <label>{tr("Branch","الفرع")}<select name="branchId" defaultValue=""><option value="">{tr("Organization-wide","على مستوى المؤسسة")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branchName(branch)}</option>)}</select></label>
        <label>{tr("Owner","المسؤول")}<select name="ownerUserId" defaultValue=""><option value="">{tr("Unassigned","غير معين")}</option>{users.map(user => <option key={user.id} value={user.id}>{userName(user)}</option>)}</select></label>
        <label>{tr("Title (English)","العنوان بالإنجليزية")}<input name="titleEn" required /></label>
        <label>{tr("Title (Arabic)","العنوان بالعربية")}<input name="titleAr" dir="rtl" /></label>
        <label>{tr("Review due","موعد المراجعة")}<SystemDateField name="reviewDueAt" /></label>
        <label>{tr("External URL","رابط خارجي")}<input name="externalUrl" type="url" /></label>
        <label className="form-span">{tr("Document content snapshot","لقطة محتوى الوثيقة")}<textarea name="content" rows={5} placeholder={tr("Controlled text content, or leave empty when using an external document URL.","محتوى نصي مضبوط، أو اتركه فارغاً عند استخدام رابط خارجي للوثيقة.")} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "document-create" ? tr("Saving…","جارٍ الحفظ…") : tr("Create Draft v1","إنشاء المسودة v1")}</button>
      </form>}
     {uiEditor === "document" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr("Controlled Documents","الوثائق المضبوطة")}</h2><span>{documents.length} {tr("shown","معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Document","الوثيقة")}</th><th>{tr("Branch","الفرع")}</th><th>{tr("Effective","الساري")}</th><th>{tr("Latest versions","أحدث الإصدارات")}</th><th>{tr("Controls","التحكم")}</th></tr></thead>
        <tbody>{documents.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr("No controlled documents.","لا توجد وثائق مضبوطة.")}</td></tr> : documents.map(document => {
          const latest = document.versions[0];
          return <tr key={document.id}>
            <td><strong>{document.code}</strong><br/><small>{documentTypeLabel(document.documentType)} · {locale === "ar" ? document.titleAr || document.titleEn : document.titleEn}</small></td>
            <td>{document.branch}</td><td>{document.currentEffectiveVersion ? "v" + document.currentEffectiveVersion : tr("None","لا يوجد")}</td>
            <td>{document.versions.slice(0,4).map(version => <div key={version.id}><small>v{version.version} · {qmsStatusLabel(version.status)}{version.reviewDueAt ? <> · {tr("review","مراجعة")} <SystemDateText value={version.reviewDueAt} kind="calendar-record" /></> : null}</small></div>)}</td>
            <td>{permissions.documents && latest && <div className="result-actions">
              {latest.status === "DRAFT" && <button type="button" className="secondary-button" onClick={() => void documentWorkflow(latest.id,"SUBMIT_REVIEW")}>{tr("Submit Review","إرسال للمراجعة")}</button>}
              {latest.status === "IN_REVIEW" && <button type="button" className="secondary-button" onClick={() => void documentWorkflow(latest.id,"COMPLETE_REVIEW")}>{tr("Complete Review","إكمال المراجعة")}</button>}
              {latest.status === "REVIEWED" && <button type="button" className="secondary-button" onClick={() => void documentWorkflow(latest.id,"APPROVE")}>{tr("Approve","اعتماد")}</button>}
              {latest.status === "APPROVED" && <button type="button" className="secondary-button" onClick={() => void documentWorkflow(latest.id,"MAKE_EFFECTIVE")}>{tr("Make Effective","جعلها سارية")}</button>}
              {["EFFECTIVE","RETIRED"].includes(latest.status) && <button type="button" className="secondary-button" onClick={() => void newDocumentVersion(document)}>{tr("New Version","إصدار جديد")}</button>}
            </div>}</td>
          </tr>;
        })}</tbody>
      </table></div>
    </section>

    {permissions.training && <section className="detail-grid detail-section">
      <article className="detail-card">
        <h2>{tr("Training Record","سجل التدريب")}</h2>
        <button type="button" className="primary-button" disabled={Boolean(busy)}
   onClick={() => { setMessage(""); setUiEditor("training"); }}>{tr("Record Training", "تسجيل تدريب")}</button>
   <CrudModal open={uiEditor === "training"} onClose={() => { if (!submitting.current && !busy) setUiEditor(""); }}
     size="compact" title={tr("Record Training", "تسجيل تدريب")}
     description={tr("Training and credential histories must be preserved for qualified staff.", "تُحفظ سجلات التدريب والتأهيل التاريخية للموظفين.")}>
     {uiEditor === "training" && <form className="catalog-form" onSubmit={createTraining}>
          <label>{tr("User","المستخدم")}<select name="userId" required defaultValue=""><option value="">{tr("Select user…","اختر المستخدم…")}</option>{users.map(user => <option key={user.id} value={user.id}>{userName(user)}</option>)}</select></label>
          <label>{tr("Branch","الفرع")}<select name="branchId" defaultValue=""><option value="">{tr("Organization-wide","على مستوى المؤسسة")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branchName(branch)}</option>)}</select></label>
          <label className="form-span">{tr("Training title","عنوان التدريب")}<input name="title" required /></label>
          <label>{tr("Provider","المزود")}<input name="provider" /></label>
          <label>{tr("SOP/document","SOP / الوثيقة")}<select name="documentVersionId" defaultValue=""><option value="">{tr("None","لا يوجد")}</option>{effectiveDocumentVersions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>{tr("Analyzer","الجهاز")}<select name="analyzerId" value={trainingAnalyzerId} onChange={event => setTrainingAnalyzerId(event.target.value)}><option value="">{tr("None","لا يوجد")}</option>{analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
          <label>{tr("Status","الحالة")}<select name="status" defaultValue="ASSIGNED"><option value="ASSIGNED">{qmsStatusLabel("ASSIGNED")}</option><option value="IN_PROGRESS">{qmsStatusLabel("IN_PROGRESS")}</option><option value="COMPLETED">{qmsStatusLabel("COMPLETED")}</option><option value="WAIVED">{qmsStatusLabel("WAIVED")}</option></select></label>
          <label>{tr("Assigned at (local date)","تاريخ التعيين (التاريخ المحلي)")}<SystemDateField name="assignedAt" required /></label>
          <label>{tr("Completed at","تاريخ الإكمال")}<SystemDateField name="completedAt" /></label>
          <label>{tr("Expires","تاريخ الانتهاء")}<SystemDateField name="expiresAt" /></label>
          <label className="form-span">{tr("Certificate URL","رابط الشهادة")}<input name="certificateUrl" type="url" /></label>
          <label className="form-span">{tr("Notes","ملاحظات")}<textarea name="notes" rows={2} /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "training-create" ? tr("Saving…","جارٍ الحفظ…") : tr("Save Training Record","حفظ سجل التدريب")}</button>
        </form>}
     {uiEditor === "training" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
      </article>

      <article className="detail-card">
        <h2>{tr("Competency Assessment","تقييم الكفاءة")}</h2>
        <button type="button" className="primary-button" disabled={Boolean(busy)}
   onClick={() => { setMessage(""); setUiEditor("competency"); }}>{tr("Record Competency Assessment", "تسجيل تقييم كفاءة")}</button>
   <CrudModal open={uiEditor === "competency"} onClose={() => { if (!submitting.current && !busy) setUiEditor(""); }}
     size="compact" title={tr("Record Competency Assessment", "تسجيل تقييم كفاءة")}
     description={tr("Competency evidence affects analyzer authorization; review real assessed values.", "تؤثر أدلة الكفاءة على صلاحيات تشغيل الأجهزة؛ راجع النتائج الحقيقية.")}>
     {uiEditor === "competency" && <form className="catalog-form" onSubmit={createCompetency}>
          <label>{tr("User","المستخدم")}<select name="userId" required defaultValue=""><option value="">{tr("Select user…","اختر المستخدم…")}</option>{users.map(user => <option key={user.id} value={user.id}>{userName(user)}</option>)}</select></label>
          <label>{tr("Branch","الفرع")}<select name="branchId" defaultValue=""><option value="">{tr("Organization-wide","على مستوى المؤسسة")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branchName(branch)}</option>)}</select></label>
          <label>{tr("Analyzer","الجهاز")}<select name="analyzerId" value={competencyAnalyzerId} onChange={event => setCompetencyAnalyzerId(event.target.value)}><option value="">{tr("None","لا يوجد")}</option>{analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
          <label>{tr("SOP/document","SOP / الوثيقة")}<select name="documentVersionId" defaultValue=""><option value="">{tr("None","لا يوجد")}</option>{effectiveDocumentVersions.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>{tr("Competency","الكفاءة")}<input name="competencyName" required /></label>
          <label>{tr("Assessment method","طريقة التقييم")}<input name="assessmentMethod" required placeholder={tr("Direct observation / blind sample / quiz…","ملاحظة مباشرة / عينة عمياء / اختبار…")} /></label>
          <label>{tr("Result","النتيجة")}<select name="result" defaultValue="PASS"><option value="PASS">{competencyResultLabel("PASS")}</option><option value="CONDITIONAL">{competencyResultLabel("CONDITIONAL")}</option><option value="FAIL">{competencyResultLabel("FAIL")}</option></select></label>
          <label>{tr("Assessed at (local date)","تاريخ التقييم (التاريخ المحلي)")}<SystemDateField name="assessedAt" required /></label>
          <label>{tr("Next due","الاستحقاق التالي")}<SystemDateField name="nextDueAt" /></label>
          <label className="form-span">{tr("Notes","ملاحظات")}<textarea name="notes" rows={2} /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "competency-create" ? tr("Saving…","جارٍ الحفظ…") : tr("Record Competency","تسجيل تقييم الكفاءة")}</button>
        </form>}
     {uiEditor === "competency" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
      </article>

      <article className="detail-card">
        <h2>{tr("Analyzer Authorization","صلاحية استخدام الجهاز")}</h2>
        <p className="muted">{tr("An active, current PASS competency assessment for the same analyzer is mandatory before authorization.","يجب توفر تقييم كفاءة حالي وناجح لنفس الجهاز قبل منح الصلاحية.")}</p>
        <button type="button" className="primary-button" disabled={Boolean(busy)}
   onClick={() => { setMessage(""); setUiEditor("authorize"); }}>{tr("Grant Analyzer Authorization", "منح صلاحية تشغيل جهاز")}</button>
   <CrudModal open={uiEditor === "authorize"} onClose={() => { if (!submitting.current && !busy) setUiEditor(""); }}
     size="compact" title={tr("Grant Analyzer Authorization", "منح صلاحية تشغيل جهاز")}
     description={tr("Equipment privileges depend on current approved competency and branch policies.", "تعتمد صلاحيات تشغيل الأجهزة على الكفاءة المعتمدة والسياسات الفرعية.")}>
     {uiEditor === "authorize" && <form className="catalog-form" onSubmit={grantAuthorization}>
          <label>{tr("User","المستخدم")}<select name="userId" required defaultValue=""><option value="">{tr("Select user…","اختر المستخدم…")}</option>{users.map(user => <option key={user.id} value={user.id}>{userName(user)}</option>)}</select></label>
          <label>{tr("Analyzer","الجهاز")}<select name="analyzerId" required defaultValue=""><option value="">{tr("Select analyzer…","اختر الجهاز…")}</option>{analyzers.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}</select></label>
          <label>{tr("Expires","تاريخ الانتهاء")}<SystemDateField name="expiresAt" /></label>
          <label className="form-span">{tr("Scope notes","ملاحظات نطاق الصلاحية")}<textarea name="scopeNotes" rows={2} /></label>
          <button className="primary-button form-span" disabled={busy !== ""}>{busy === "authorization-create" ? tr("Saving…","جارٍ الحفظ…") : tr("Grant Authorization","منح الصلاحية")}</button>
        </form>}
     {uiEditor === "authorize" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
      </article>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr("Training & Competency","التدريب والكفاءة")}</h2><span>{trainingRecords.length} {tr("training","تدريب")} · {competencies.length} {tr("assessments","تقييم")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("User","المستخدم")}</th><th>{tr("Training","التدريب")}</th><th>{tr("Status","الحالة")}</th><th>{tr("Analyzer / Document","الجهاز / الوثيقة")}</th><th>{tr("Dates","التواريخ")}</th></tr></thead>
        <tbody>{trainingRecords.length === 0 ? <tr><td colSpan={5} className="empty-state">{tr("No training records.","لا توجد سجلات تدريب.")}</td></tr> : trainingRecords.map(item => <tr key={item.id}><td>{item.user}</td><td>{item.title}</td><td>{qmsStatusLabel(item.status)}</td><td>{item.analyzer || item.document || "—"}</td><td><SystemDateText value={item.assignedAt} kind="instant-date" />{item.expiresAt ? <> → <SystemDateText value={item.expiresAt} kind="calendar-record" /></> : null}</td></tr>)}</tbody>
      </table></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("User","المستخدم")}</th><th>{tr("Competency","الكفاءة")}</th><th>{tr("Analyzer","الجهاز")}</th><th>{tr("Result","النتيجة")}</th><th>{tr("Assessed","تاريخ التقييم")}</th><th>{tr("Next due","الاستحقاق التالي")}</th></tr></thead>
        <tbody>{competencies.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr("No competency assessments.","لا توجد تقييمات كفاءة.")}</td></tr> : competencies.map(item => <tr key={item.id}><td>{item.user}</td><td>{item.competencyName}</td><td>{item.analyzer || "—"}</td><td>{competencyResultLabel(item.result)}</td><td><SystemDateText value={item.assessedAt} kind="calendar-record" /></td><td>{item.nextDueAt ? <SystemDateText value={item.nextDueAt} kind="calendar-record" /> : "—"}</td></tr>)}</tbody>
      </table></div>
    </section>

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr("Analyzer Authorizations","صلاحيات استخدام الأجهزة")}</h2><span>{authorizations.length} {tr("shown","معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("User","المستخدم")}</th><th>{tr("Analyzer","الجهاز")}</th><th>{tr("Status","الحالة")}</th><th>{tr("Authorized","تاريخ التفويض")}</th><th>{tr("Expires","الانتهاء")}</th><th>{tr("Approved by","اعتمد بواسطة")}</th><th>{tr("Action","الإجراء")}</th></tr></thead>
        <tbody>{authorizations.length === 0 ? <tr><td colSpan={7} className="empty-state">{tr("No analyzer authorizations.","لا توجد صلاحيات أجهزة.")}</td></tr> : authorizations.map(item => <tr key={item.id}><td>{item.user}</td><td>{item.analyzer}</td><td>{qmsStatusLabel(item.status)}</td><td><SystemDateText value={item.authorizedAt} kind="instant-date" /></td><td>{item.expiresAt ? <SystemDateText value={item.expiresAt} kind="calendar-record" /> : "—"}</td><td>{item.approvedBy}</td><td>{permissions.training && item.status === "ACTIVE" && <button type="button" className="secondary-button" onClick={() => void revokeAuthorization(item)}>{tr("Revoke","إلغاء الصلاحية")}</button>}</td></tr>)}</tbody>
      </table></div>
    </section>

    {permissions.indicators && <section className="detail-card detail-section">
      <h2>{tr("Quality Indicator","مؤشر جودة")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
   onClick={() => { setMessage(""); setUiEditor("indicator"); }}>{tr("Create Quality Indicator", "إنشاء مؤشر جودة")}</button>
   <CrudModal open={uiEditor === "indicator"} onClose={() => { if (!submitting.current && !busy) setUiEditor(""); }}
     size="compact" title={tr("Create Quality Indicator", "إنشاء مؤشر جودة")}
     description={tr("Targets and units must come from approved policy, not assumed thresholds.", "يجب أن تأتي الأهداف والوحدات من سياسة معتمدة دون افتراض حدود.")}>
     {uiEditor === "indicator" && <form className="catalog-form" onSubmit={createIndicator}>
        <label>{tr("Code","الرمز")}<input name="code" required /></label>
        <label>{tr("Branch","الفرع")}<select name="branchId" defaultValue=""><option value="">{tr("Organization-wide","على مستوى المؤسسة")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branchName(branch)}</option>)}</select></label>
        <label>{tr("Name (English)","الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Name (Arabic)","الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <label>{tr("Direction","الاتجاه")}<select name="direction" defaultValue="LOWER_IS_BETTER"><option value="LOWER_IS_BETTER">{directionLabel("LOWER_IS_BETTER")}</option><option value="HIGHER_IS_BETTER">{directionLabel("HIGHER_IS_BETTER")}</option><option value="TARGET_RANGE">{directionLabel("TARGET_RANGE")}</option></select></label>
        <label>{tr("Unit","الوحدة")}<input name="unit" placeholder={tr("% / min / count…","% / دقيقة / عدد…")} /></label>
        <label>{tr("Target min","الحد الأدنى المستهدف")}<input name="targetMin" inputMode="decimal" /></label>
        <label>{tr("Target max","الحد الأعلى المستهدف")}<input name="targetMax" inputMode="decimal" /></label>
        <label className="form-span">{tr("Description","الوصف")}<textarea name="description" rows={2} /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "indicator-create" ? tr("Saving…","جارٍ الحفظ…") : tr("Create Indicator","إنشاء المؤشر")}</button>
      </form>}
     {uiEditor === "indicator" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr("Quality Indicators","مؤشرات الجودة")}</h2><span>{indicators.length} {tr("shown","معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Indicator","المؤشر")}</th><th>{tr("Scope","النطاق")}</th><th>{tr("Direction","الاتجاه")}</th><th>{tr("Target","الهدف")}</th><th>{tr("Latest value","أحدث قيمة")}</th><th>{tr("Action","الإجراء")}</th></tr></thead>
        <tbody>{indicators.length === 0 ? <tr><td colSpan={6} className="empty-state">{tr("No quality indicators.","لا توجد مؤشرات جودة.")}</td></tr> : indicators.map(item => {
          const latest = item.measurements[0];
          const target = item.direction === "TARGET_RANGE" ? `${item.targetMin || "—"}–${item.targetMax || "—"}` : item.direction === "LOWER_IS_BETTER" ? `≤ ${item.targetMax || "—"}` : `≥ ${item.targetMin || "—"}`;
          return <tr key={item.id}><td><strong>{item.code}</strong><br/><small>{locale === "ar" ? item.nameAr || item.nameEn : item.nameEn}</small></td><td>{item.branch}</td><td>{directionLabel(item.direction)}</td><td>{target} {item.unit || ""}</td><td>{latest ? <>{latest.value} {item.unit || ""} · <SystemDateText value={latest.periodEnd} kind="calendar-record" /></> : "—"}</td><td>{permissions.indicators && <button type="button" className="secondary-button" onClick={() => void addMeasurement(item)}>{tr("Add Measurement","إضافة قياس")}</button>}</td></tr>;
        })}</tbody>
      </table></div>
    </section>

    {permissions.audits && <section className="detail-card detail-section">
      <h2>{tr("Plan Internal Audit","تخطيط تدقيق داخلي")}</h2>
      <button type="button" className="primary-button" disabled={Boolean(busy)}
   onClick={() => { setMessage(""); setUiEditor("audit"); }}>{tr("Plan Internal Audit", "تخطيط تدقيق داخلي")}</button>
   <CrudModal open={uiEditor === "audit"} onClose={() => { if (!submitting.current && !busy) setUiEditor(""); }}
     size="compact" title={tr("Plan Internal Audit", "تخطيط تدقيق داخلي")}
     description={tr("Audit scope and accountable staff must be documented and traceable.", "يجب توثيق نطاق التدقيق والمسؤولين مع قابلية التتبع.")}>
     {uiEditor === "audit" && <form className="catalog-form" onSubmit={createAudit}>
        <label>{tr("Branch","الفرع")}<select name="branchId" defaultValue=""><option value="">{tr("Organization-wide","على مستوى المؤسسة")}</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branchName(branch)}</option>)}</select></label>
        <label>{tr("Lead auditor","المدقق الرئيسي")}<select name="leadAuditorUserId" required defaultValue=""><option value="">{tr("Select auditor…","اختر المدقق…")}</option>{users.map(user => <option key={user.id} value={user.id}>{userName(user)}</option>)}</select></label>
        <label>{tr("Scheduled date","التاريخ المجدول")}<SystemDateField name="scheduledAt" required /></label>
        <label className="form-span">{tr("Title","العنوان")}<input name="title" required /></label>
        <label className="form-span">{tr("Scope","النطاق")}<textarea name="scope" rows={3} required /></label>
        <button className="primary-button form-span" disabled={busy !== ""}>{busy === "audit-create" ? tr("Saving…","جارٍ الحفظ…") : tr("Plan Internal Audit","تخطيط التدقيق الداخلي")}</button>
      </form>}
     {uiEditor === "audit" && message && <p className="form-warning" role="status">{message}</p>}
   </CrudModal>
    </section>}

    <section className="table-card detail-section">
      <div className="table-toolbar"><h2>{tr("Internal Audits","عمليات التدقيق الداخلي")}</h2><span>{audits.length} {tr("shown","معروضة")}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Audit","التدقيق")}</th><th>{tr("Scope","النطاق")}</th><th>{tr("Branch","الفرع")}</th><th>{tr("Status","الحالة")}</th><th>{tr("Lead","المدقق الرئيسي")}</th><th>{tr("Scheduled","المجدول")}</th><th>{tr("Findings","الملاحظات")}</th><th>{tr("Controls","التحكم")}</th></tr></thead>
        <tbody>{audits.length === 0 ? <tr><td colSpan={8} className="empty-state">{tr("No internal audits.","لا توجد عمليات تدقيق داخلي.")}</td></tr> : audits.map(audit => <tr key={audit.id}>
          <td><strong>{audit.auditNumber}</strong><br/><small>{audit.title}</small></td><td>{audit.scope}</td><td>{audit.branch}</td><td>{qmsStatusLabel(audit.status)}</td><td>{audit.leadAuditor}</td><td><SystemDateText value={audit.scheduledAt} kind="calendar-record" /></td>
          <td>{audit.findings.length === 0 ? "—" : audit.findings.map(finding => <div key={finding.id}><small>{finding.findingNumber} · {severityLabel(finding.severity)} · {qmsStatusLabel(finding.status)}{finding.capaNumber ? " · " + finding.capaNumber : ""}</small>{permissions.audits && finding.status !== "CLOSED" && <button type="button" className="table-action" onClick={() => void closeFinding(audit.id,finding.id)}>{tr("Close","إغلاق")}</button>}</div>)}</td>
          <td>{permissions.audits && !["COMPLETED","CANCELLED"].includes(audit.status) && <div className="result-actions"><button type="button" className="secondary-button" onClick={() => void addFinding(audit)}>{tr("Add Finding","إضافة ملاحظة")}</button><button type="button" className="secondary-button" onClick={() => void completeAudit(audit)}>{tr("Complete","إكمال")}</button></div>}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  <CrudModal open={pendingReview!==null}
    onClose={()=>{if(!submitting.current&&!busy)setPendingReview(null);}}
    size="compact"
    title={pendingReview ? reviewLabel(pendingReview.kind) : tr("Quality Review","مراجعة الجودة")}
    description={tr(
      "Review this exact governed quality action and all supporting evidence before submitting. Only server-authorized staff may change the audited workflow.",
      "راجع إجراء الجودة المحدد والأدلة الداعمة قبل الإرسال. لا يُسمح إلا للموظفين المخوّلين بتغيير مسار العمل المدقق.",
    )}>
    {pendingReview&&<form className="catalog-form" onSubmit={confirmQualityReview}>
      {pendingReview.kind==="NC_STATUS" && (pendingReview.close
        ? <>
          <label className="form-span">{tr("Verified root cause (required)","السبب الجذري المثبت (مطلوب)")}
            <textarea name="rootCause" required rows={3} maxLength={4000} defaultValue={pendingReview.rootCause}/></label>
          <label className="form-span">{tr("Closure summary (required)","ملخص الإغلاق (مطلوب)")}
            <textarea name="closureSummary" required rows={3} maxLength={4000} defaultValue={pendingReview.closureSummary}/></label>
          <p className="muted form-span">{tr("Linked CAPA records must already be closed; the full nonconformance audit trail remains retained.",
            "يجب أن تكون إجراءات CAPA المرتبطة مغلقة؛ يبقى سجل تدقيق عدم المطابقة محفوظاً.")}</p>
        </>
        : <p className="form-span">{tr("Move this nonconformance to investigation? Historical records will be retained.",
          "نقل حالة عدم المطابقة إلى التحقيق؟ ستظل السجلات التاريخية محفوظة.")}</p>)}
      {pendingReview.kind==="CAPA_ACTION_CREATE" && <>
        <label className="form-span">{tr("Action type","نوع الإجراء")}
          <select name="actionType" required defaultValue="CORRECTIVE">
            <option value="CORRECTIVE">{tr("Corrective action","إجراء تصحيحي")}</option>
            <option value="PREVENTIVE">{tr("Preventive action","إجراء وقائي")}</option>
          </select></label>
        <label className="form-span">{tr("Action description","وصف الإجراء")}
          <textarea name="description" rows={3} maxLength={4000} required/></label>
        <label>{tr("Due date (optional)","تاريخ الاستحقاق (اختياري)")}
          <SystemDateField name="dueDate" /></label>
      </>}
      {pendingReview.kind==="CAPA_ACTION_COMPLETE" && <p className="form-span">{tr(
        "Confirm this exact CAPA action has been completed with supporting evidence. This action will be audited.",
        "تأكد من اكتمال إجراء CAPA المحدد مع أدلة داعمة؛ سيُدقّق هذا الإجراء.")}</p>}
      {pendingReview.kind==="CAPA_EFFECTIVENESS" && <>
        <label className="form-span">{tr("Effectiveness outcome","نتيجة مراجعة الفعالية")}
          <select name="effectiveness" required value={reviewEffectiveness}
            onChange={event=>setReviewEffectiveness(event.target.value)}>
            <option value="EFFECTIVE">{tr("Effective","فعّال")}</option>
            <option value="PARTIALLY_EFFECTIVE">{tr("Partially effective","فعّال جزئياً")}</option>
            <option value="INEFFECTIVE">{tr("Ineffective","غير فعّال")}</option>
          </select></label>
        <label className="form-span">{tr("Document independent effectiveness evidence","وثّق أدلة الفعالية للمراجع المستقل")}
          <textarea name="effectivenessReview" rows={3} required maxLength={4000}/></label>
        {reviewEffectiveness==="EFFECTIVE" && <label className="check-line form-span">
          <input name="close" type="checkbox"/>
          {tr("Also close CAPA if all required actions are complete","إغلاق CAPA أيضاً إذا اكتملت جميع الإجراءات المطلوبة")}
        </label>}
      </>}
      {pendingReview.kind==="DOCUMENT_VERSION_CREATE" && <>
        <label className="form-span">{tr("Version change summary","ملخص تغييرات الإصدار")}
          <textarea name="changeSummary" rows={2} required maxLength={4000}/></label>
        <label className="form-span">{tr("Controlled document text (one content source)","نص الوثيقة المضبوطة (أحد مصادر المحتوى)")}
          <textarea name="content" rows={5}/></label>
        <label className="form-span">{tr("OR external document URL","أو رابط خارجي للوثيقة")}
          <input name="externalUrl" type="url"/></label>
        <p className="muted form-span">{tr(
          "Enter the content OR the external document URL, not both. A new immutable version is created.",
          "أدخل نص الوثيقة أو رابطها فقط دون الجمع بينهما؛ ينشأ إصدار جديد ثابت.")}</p>
      </>}
      {pendingReview.kind==="DOCUMENT_WORKFLOW" && <p className="form-span">
        {tr("Confirm the exact workflow transition","تأكيد انتقال حوكمة الوثيقة المحدد")}:{" "}
        <strong>{pendingReview.operation}</strong>
        <span className="table-subtext">{tr(
          "Independent approval and effective version policies remain server-enforced.",
          "تبقى متطلبات الاعتماد المستقل وسياسات سريان الإصدار مفروضة من السيرفر.")}</span>
      </p>}
      {pendingReview.kind==="ANALYZER_REVOKE" && <>
        <p className="form-span">{tr("Revoke this equipment authorization? The prior competency record is preserved.",
          "إلغاء صلاحية تشغيل هذا الجهاز؟ يبقى سجل الكفاءة السابق محفوظاً.")}</p>
        <label className="form-span">{tr("Documented revocation reason","سبب إلغاء الصلاحية الموثق")}
          <textarea name="reason" required rows={3} maxLength={1000}/></label>
      </>}
      {pendingReview.kind==="INDICATOR_MEASUREMENT" && <>
        <label>{tr("Period start","بداية الفترة")}<SystemDateField name="periodStart" required /></label>
        <label>{tr("Period end","نهاية الفترة")}<SystemDateField name="periodEnd" required /></label>
        <label className="form-span">{tr("Measured value","القيمة المقاسة")}{" "}
          {pendingReview.unit && <small>({pendingReview.unit})</small>}
          <input name="value" required inputMode="decimal" maxLength={100}/></label>
        <label>{tr("Numerator (optional)","البسط (اختياري)")}
          <input name="numerator" inputMode="decimal"/></label>
        <label>{tr("Denominator (optional)","المقام (اختياري)")}
          <input name="denominator" inputMode="decimal"/></label>
      </>}
      {pendingReview.kind==="AUDIT_FINDING_CREATE" && <>
        <label className="form-span">{tr("Audit finding severity","شدة ملاحظة التدقيق")}
          <select name="severity" value={reviewSeverity} onChange={event=>setReviewSeverity(event.target.value)} required>
            <option value="OBSERVATION">{tr("Observation","ملاحظة")}</option>
            <option value="MINOR">{tr("Minor","طفيفة")}</option>
            <option value="MAJOR">{tr("Major","جسيمة")}</option>
            <option value="CRITICAL">{tr("Critical","حرجة")}</option>
          </select></label>
        <label className="form-span">{tr("Finding description","وصف الملاحظة")}
          <textarea name="description" rows={3} required maxLength={4000}/></label>
        <label className="form-span">{tr("SOP / standard / clause reference (optional)","مرجع المعيار أو الإجراء أو البند (اختياري)")}
          <input name="requirementRef" maxLength={400}/></label>
        <label className="form-span">{reviewSeverity==="CRITICAL"
          ? tr("Existing open CAPA (required for critical findings)","ملف CAPA مفتوح (إلزامي للملاحظات الحرجة)")
          : tr("Existing open CAPA (optional)","ملف CAPA مفتوح (اختياري)")}
          <select name="capaId" required={reviewSeverity==="CRITICAL"} defaultValue="">
            <option value="">{tr("Select open CAPA","اختر ملف CAPA مفتوحاً")}</option>
            {openCapas.map(capa=><option key={capa.id} value={capa.id}>
              {capa.capaNumber} — {capa.title}</option>)}
          </select></label>
      </>}
      {pendingReview.kind==="AUDIT_FINDING_CLOSE" && <label className="form-span">
        {tr("Finding closure note","ملاحظة إغلاق التدقيق")}
        <textarea name="closureNote" rows={3} required maxLength={4000}/></label>}
      {pendingReview.kind==="AUDIT_COMPLETE" && <>
        <p className="form-span">{tr("All audit findings must already be closed. Completion is audited.",
          "يجب إغلاق جميع ملاحظات التدقيق مسبقاً؛ سيُدقق الإكمال.")}</p>
        <label className="form-span">{tr("Internal audit completion summary","ملخص إكمال التدقيق الداخلي")}
          <textarea name="summary" rows={3} required maxLength={4000}/></label>
      </>}
      {reviewError && <p className="form-error form-span" role="alert">{reviewError}</p>}
      {message && <p className={(isError ? "form-error" : "form-success") + " form-span"} role={isError ? "alert" : "status"}>{message}</p>}
      <button type="submit" className="primary-button form-span" disabled={Boolean(busy)}>
        {busy ? tr("Processing…","جارٍ التنفيذ…") : tr("Confirm governed action","تأكيد الإجراء المحكوم")}
      </button>
    </form>}
  </CrudModal>
  </div>;
}
