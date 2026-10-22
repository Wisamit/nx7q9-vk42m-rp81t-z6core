"use client";

import { SystemDateField } from "@/components/system-date-field";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type PatientOption = { id: string; patientNumber: string; fullNameEn: string; phone: string | null };
type OrderQuestionChoice = {
  code: string;
  valueEn: string;
  valueAr: string | null;
};
type OrderQuestionOption = {
  id: string;
  code: string;
  questionEn: string;
  questionAr: string | null;
  responseType: "TEXT" | "NUMERIC" | "BOOLEAN" | "DATE" | "DATETIME" | "SINGLE_CHOICE";
  required: boolean;
  options: OrderQuestionChoice[];
  displayOrder: number;
};
type TestOption = { id: string; code: string; nameEn: string; orderQuestions: OrderQuestionOption[] };
type PackageOption = { id: string; code: string; nameEn: string; testIds: string[] };
type SimpleOption = { id: string; code: string; nameEn: string };
type ReferrerOption = SimpleOption & { clientId: string | null };
type SourceOption = SimpleOption & { category: string };
type BranchOption = SimpleOption & { timezone: string };
type OrderCreateResponse = {
  accessionNumber?: string;
  invoiceNumber?: string;
  currency?: string;
  total?: string | number;
  taxTotal?: string | number;
  creditControl?: { decision?: string };
  error?: string;
  tests?: Array<{ code?: string }>;
  packages?: Array<{ code?: string }>;
  approvalRequestId?: string;
  limitAmount?: string | number;
  exposureBefore?: string | number;
  projectedExposure?: string | number;
};

export type DoctorRequisitionPrefill = {
  id:string;patientId:string;branchId:string;referrerId:string;
  priority:"ROUTINE"|"URGENT"|"STAT";testIds:string[];
  diagnosis:string|null;clinicalNotes:string|null;
};

export function OrderCreateForm({
  patients,
  tests,
  packages,
  clients,
  referrers,
  sources,
  branches,
  activeBranchId,
  discountLimitPercent,
  locale,
  onSuccess,
  initialDoctorRequisition,
}: {
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
  onSuccess?: (message: string) => void;
  initialDoctorRequisition?: DoctorRequisitionPrefill | null;
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [patientSearch, setPatientSearch] = useState(() => {
    const patient=patients.find(p=>p.id===initialDoctorRequisition?.patientId);
    return patient ? `${patient.patientNumber} — ${patient.fullNameEn}${patient.phone ? " — "+patient.phone : ""}` : "";
  });
  const [patientId, setPatientId] = useState(initialDoctorRequisition?.patientId || "");
  const [testSearch, setTestSearch] = useState("");
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>(initialDoctorRequisition?.testIds || []);
  const [packageSearch, setPackageSearch] = useState("");
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const ambiguousSubmissionRef = useRef(false);
  const [ambiguousSubmission, setAmbiguousSubmission] = useState(false);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountApprovalRequestId, setDiscountApprovalRequestId] = useState("");
  const [pregnancyStatus, setPregnancyStatus] = useState<"UNKNOWN" | "NOT_PREGNANT" | "PREGNANT">("UNKNOWN");

  const patientOptions = useMemo(() => patients.map(p => ({
    ...p,
    label: `${p.patientNumber} — ${p.fullNameEn}${p.phone ? ` — ${p.phone}` : ""}`,
  })), [patients]);

  const testOptions = useMemo(() => tests.map(t => ({ ...t, label: `${t.code} — ${t.nameEn}` })), [tests]);
  const packageOptions = useMemo(() => packages.map(pkg => ({ ...pkg, label: `${pkg.code} — ${pkg.nameEn}` })), [packages]);
  const selectedPackages = selectedPackageIds.map(id => packages.find(pkg => pkg.id === id)).filter((x): x is PackageOption => Boolean(x));
  const packageTestIds = useMemo(() => [...new Set(selectedPackages.flatMap(pkg => pkg.testIds))], [selectedPackages]);
  const effectiveTestIds = useMemo(() => [...new Set([...selectedTestIds, ...packageTestIds])], [selectedTestIds, packageTestIds]);
  const selectedTests = effectiveTestIds.map(id => tests.find(t => t.id === id)).filter((x): x is TestOption => Boolean(x));

  function addTest() {
    const match = testOptions.find(t => t.label === testSearch);
    if (!match) {
      setMessage(tr("Select a valid test from the search suggestions.", "اختر فحصًا صحيحًا من اقتراحات البحث."));
      return;
    }
    if (packageTestIds.includes(match.id)) {
      setMessage(tr("This test is already included in a selected commercial package.", "هذا الفحص موجود بالفعل ضمن باقة تجارية محددة."));
      return;
    }
    setSelectedTestIds(ids => ids.includes(match.id) ? ids : [...ids, match.id]);
    setTestSearch("");
    setMessage("");
  }

  function addPackage() {
    const match = packageOptions.find(pkg => pkg.label === packageSearch);
    if (!match) {
      setMessage(tr("Select a valid commercial package from the suggestions.", "اختر باقة تجارية صحيحة من الاقتراحات."));
      return;
    }
    if (selectedTestIds.some(testId => match.testIds.includes(testId))) {
      setMessage(tr("Remove directly selected tests that are already included in this package.", "احذف الفحوصات المختارة مباشرة والموجودة أصلًا ضمن هذه الباقة."));
      return;
    }
    const otherPackageTests = new Set(selectedPackages.flatMap(pkg => pkg.testIds));
    if (match.testIds.some(testId => otherPackageTests.has(testId))) {
      setMessage(tr("Selected packages cannot contain overlapping tests.", "لا يمكن اختيار باقات تحتوي على فحوصات متداخلة."));
      return;
    }
    setSelectedPackageIds(ids => ids.includes(match.id) ? ids : [...ids, match.id]);
    setPackageSearch("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || ambiguousSubmissionRef.current) return;
    if (initialDoctorRequisition && (
      patientId!==initialDoctorRequisition.patientId ||
      new Set(effectiveTestIds).size!==initialDoctorRequisition.testIds.length ||
      initialDoctorRequisition.testIds.some(id=>!effectiveTestIds.includes(id)) ||
      selectedPackageIds.length>0
    )) { setMessage(tr("Requisition contents cannot be changed; return to the review queue.",
      "لا يمكن تعديل محتويات إحالة الطبيب؛ ارجع لقائمة المراجعة."));return; }
    if (!patientId) { setMessage(tr("Select a valid patient.", "اختر مريضًا صحيحًا.")); return; }
    if (effectiveTestIds.length === 0) { setMessage(tr("Add at least one test or commercial package.", "أضف فحصًا واحدًا أو باقة تجارية واحدة على الأقل.")); return; }

    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    submitting.current = true;
    setBusy(true);
    setMessage("");

    const fastingValue = form.get("fasting");
    const fasting = fastingValue === "YES" ? true : fastingValue === "NO" ? false : null;
    const answers = selectedTests.flatMap(test => test.orderQuestions.map(question => ({
      questionId: question.id,
      value: form.get("question_" + question.id),
    })));

    try {
    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchId: form.get("branchId"),
        doctorRequisitionId: initialDoctorRequisition?.id || null,
        patientId,
        sourceId: form.get("sourceId"),
        referrerId: form.get("referrerId"),
        clientId: form.get("clientId"),
        priority: form.get("priority"),
        promisedReportDeliveryLocal: form.get("promisedReportDeliveryLocal"),
        fasting,
        diagnosis: form.get("diagnosis"),
        clinicalNotes: form.get("clinicalNotes"),
        pregnancyInfo: form.get("pregnancyInfo"),
        pregnancyStatus: form.get("pregnancyStatus"),
        gestationalAgeWeeks: form.get("gestationalAgeWeeks"),
        referencePopulationCode: form.get("referencePopulationCode"),
        discountPercent,
        discountReason: form.get("discountReason"),
        discountApprovalRequestId: discountApprovalRequestId || null,
        testIds: selectedTestIds,
        packageIds: selectedPackageIds,
        answers,
      }),
    });

    const rawBody = await response.json().catch(() => null);
    const body = rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? rawBody as OrderCreateResponse : null;
    const confirmedReceipt = body &&
      typeof body.accessionNumber === "string" && body.accessionNumber.length > 0 &&
      typeof body.invoiceNumber === "string" && body.invoiceNumber.length > 0 &&
      typeof body.currency === "string" && body.currency.length > 0 &&
      (typeof body.total === "string" || typeof body.total === "number") &&
      String(body.total).length > 0;
    if (response.status >= 500 || (response.ok && !confirmedReceipt) ||
        (!response.ok && (!body || typeof body.error !== "string"))) {
      // The database may already contain an order and invoice; no blind retry.
      ambiguousSubmissionRef.current = true;
      setAmbiguousSubmission(true);
      setMessage(tr(
        "Order/invoice creation could not be confirmed. Do not submit this form again. Keep a copy of the entered data, then reload and reconcile Orders and Billing before starting a new request.",
        "لم يتم تأكيد إنشاء الطلب والفاتورة. لا تعِد إرسال النموذج. احتفظ بنسخة من المدخلات، ثم أعد تحميل الصفحة وطابق الطلبات والفوترة قبل إنشاء طلب جديد.",
      ));
      return;
    }
    if (!body) return;
    if (response.ok) {
      const creditWarning = body.creditControl?.decision === "WARN_EXCEEDED"
        ? tr(" · WARNING: client credit limit exceeded (recorded).", " · تحذير: تم تجاوز حد ائتمان العميل وتسجيل الحالة.")
        : "";
      const taxSummary = Number(body.taxTotal || 0) > 0
        ? ` · ${tr("Tax", "الضريبة")}: ${body.taxTotal} ${body.currency}`
        : "";
      const success = `${tr("Order", "الطلب")} ${body.accessionNumber} ${tr("created", "تم إنشاؤه")} · ${tr("Invoice", "الفاتورة")} ${body.invoiceNumber} · ${body.total} ${body.currency}${taxSummary}${creditWarning}`;
      setMessage(success);
      setPatientId("");
      setPatientSearch("");
      setSelectedTestIds([]);
      setSelectedPackageIds([]);
      setPackageSearch("");
      setDiscountPercent(0);
      setDiscountApprovalRequestId("");
      setPregnancyStatus("UNKNOWN");
      formElement.reset();
      router.refresh();
      onSuccess?.(success);
    } else if (body.error === "invalid_gestational_age") {
      setMessage(tr("Gestational age must be a non-negative number.", "يجب أن يكون عمر الحمل رقمًا غير سالب."));
    } else if (body.error === "gestational_age_requires_pregnant_status") {
      setMessage(tr("Gestational age can only be recorded when pregnancy status is Pregnant.", "لا يمكن تسجيل عمر الحمل إلا عندما تكون حالة الحمل: حامل."));
    } else if (body.error === "tax_configuration_changed") {
      setMessage(tr("Tax configuration changed while registering this order. Review the amounts and submit again.", "تغير إعداد الضريبة أثناء تسجيل الطلب. راجع المبالغ ثم أعد الإرسال."));
    } else if (body.error === "invalid_tax_rule") {
      setMessage(tr("One or more active tax rules are invalid. Contact Billing Administration.", "توجد قاعدة ضريبية فعالة غير صالحة. تواصل مع إدارة الفوترة."));
    } else if (body.error === "credit_limit_exceeded") {
      setMessage(`${tr("Credit limit exceeded; no order or invoice was created.", "تم تجاوز حد الائتمان ولم يتم إنشاء طلب أو فاتورة.")} ${tr("Limit", "الحد")}: ${body.limitAmount} ${body.currency} · ${tr("Outstanding", "القائم")}: ${body.exposureBefore} · ${tr("Projected", "المتوقع")}: ${body.projectedExposure}`);
    } else if (body.error === "client_credit_state_changed") {
      setMessage(tr("Client credit state changed during processing. Review the account and submit again.", "تغيرت حالة ائتمان العميل أثناء المعالجة. راجع الحساب ثم أعد الإرسال."));
    } else if (body.error === "discount_approval_required") {
      setDiscountApprovalRequestId(typeof body.approvalRequestId === "string" ? body.approvalRequestId : "");
      setMessage(tr(
        "Discount approval requested. Ask an authorized manager to approve it in Billing, then submit this same order again without changing its pricing context.",
        "تم إرسال طلب اعتماد الخصم. اطلب من مدير مخول اعتماده من شاشة الفوترة، ثم أعد إرسال نفس الطلب دون تغيير بيانات التسعير.",
      ));
    } else if (body.error === "discount_approval_pending") {
      setDiscountApprovalRequestId(typeof body.approvalRequestId === "string" ? body.approvalRequestId : discountApprovalRequestId);
      setMessage(tr("Discount approval is still pending.", "طلب اعتماد الخصم ما زال قيد الانتظار."));
    } else if (body.error === "discount_approval_rejected") {
      setDiscountApprovalRequestId("");
      setMessage(tr("The discount request was rejected. Adjust the discount or request a new approval.", "تم رفض طلب الخصم. عدّل الخصم أو أنشئ طلب اعتماد جديد."));
    } else if (body.error === "discount_approval_expired" || body.error === "discount_approval_used") {
      setDiscountApprovalRequestId("");
      setMessage(tr("The discount approval is no longer valid. Submit again to create a new request.", "لم تعد موافقة الخصم صالحة. أعد الإرسال لإنشاء طلب جديد."));
    } else if (body.error === "discount_approval_context_changed") {
      setDiscountApprovalRequestId("");
      setMessage(tr("Order pricing context changed after the approval request. Submit again to create a fresh approval request.", "تغيّر سياق تسعير الطلب بعد طلب الاعتماد. أعد الإرسال لإنشاء طلب اعتماد جديد."));
    } else if (body.error === "discount_reason_required") {
      setMessage(tr("A discount reason is required.", "سبب الخصم مطلوب."));
    } else if (body.error === "invalid_discount_percent") {
      setMessage(tr("Discount percentage must be between 0 and 100.", "يجب أن تكون نسبة الخصم بين 0 و100."));
    } else if (body.error === "missing_prices") {
      const codes = Array.isArray(body.tests) ? body.tests.map((x: { code?: string }) => x.code).filter(Boolean).join(", ") : "";
      setMessage(`${tr("Missing active prices for", "لا توجد أسعار فعالة لـ")}: ${codes || tr("selected tests", "الفحوصات المحددة")}. ${tr("Configure Pricing first.", "قم بإعداد الأسعار أولًا.")}`);
    } else if (body.error === "missing_package_prices") {
      const codes = Array.isArray(body.packages) ? body.packages.map((x: { code?: string }) => x.code).filter(Boolean).join(", ") : "";
      setMessage(`${tr("Missing active package prices for", "لا توجد أسعار فعالة للباقات")}: ${codes || tr("selected packages", "الباقات المحددة")}. ${tr("Configure Pricing first.", "قم بإعداد الأسعار أولًا.")}`);
    } else if (body.error === "package_test_overlap" || body.error === "package_direct_test_overlap") {
      setMessage(tr("Commercial packages and directly selected tests must not overlap.", "يجب ألا تتداخل الباقات التجارية مع الفحوصات المختارة مباشرة."));
    } else if (body.error === "mixed_currencies_not_allowed") {
      setMessage(tr("Selected tests/packages resolve to different currencies. One order invoice must use a single currency.", "الفحوصات أو الباقات المحددة تستخدم عملات مختلفة. يجب أن تستخدم فاتورة الطلب عملة واحدة فقط."));
    } else {
      setMessage(body.error || tr("Could not create order.", "تعذر إنشاء الطلب."));
    }
    } catch {
      ambiguousSubmissionRef.current = true;
      setAmbiguousSubmission(true);
      setMessage(tr(
        "Connection interrupted; the order and invoice may already exist. Do not submit again. Preserve your entries, then reload and reconcile Orders and Billing first.",
        "انقطع الاتصال وربما تم إنشاء الطلب والفاتورة. لا تعِد الإرسال. احتفظ بالمدخلات، ثم أعد تحميل الصفحة وراجع الطلبات والفوترة أولاً.",
      ));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return <form className="order-form" onSubmit={submit}>
    <div className="form-grid">
      <div className="form-span order-step-heading">
        <span className="order-step-index" aria-hidden="true">01</span>
        <div><strong>{tr("Patient and ordering context", "المريض وبيانات الطلب")}</strong>
          <p>{tr("Confirm patient identifier, branch, priority and clinical context before continuing.", "تأكد من معرف المريض والفرع والأولوية والسياق السريري قبل المتابعة.")}</p></div>
      </div>
      {initialDoctorRequisition && <p className="form-warning form-span">
        {tr("Physician requisition conversion: patient, branch, referrer, tests, priority and original clinical text are fixed. Choose billing source, verify test-specific questions and register through standard pricing.",
        "تحويل إحالة طبيب: المريض والفرع والمحيل والفحوصات والأولوية والنص السريري الأصلي ثابتة. اختر مصدر الفوترة وتحقق من الأسئلة الخاصة بالفحوصات ثم سجّل وفق التسعير الاعتيادي.")}
      </p>}
      <label>{tr("Ordering branch", "فرع الطلب")}
        <select name="branchId" required defaultValue={initialDoctorRequisition?.branchId || activeBranchId || ""}>
          <option value="">{tr("Select branch…", "اختر الفرع…")}</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn} ({branch.timezone})</option>)}
        </select>
      </label>
      <label>{tr("Priority", "الأولوية")}
        <select name="priority" defaultValue={initialDoctorRequisition?.priority || "ROUTINE"}><option value="ROUTINE">{tr("Routine", "عادي")}</option><option value="URGENT">{tr("Urgent", "عاجل")}</option><option value="STAT">{tr("STAT", "فوري")}</option></select>
      </label>

      <label>{tr("Promised report delivery (optional, ordering branch local time)", "موعد تسليم التقرير المتفق عليه (اختياري، بتوقيت فرع الطلب)")}
        <input name="promisedReportDeliveryLocal" type="datetime-local" step="60" />
        <small>{tr("Staff-entered patient commitment, distinct from laboratory TAT. The branch timezone is saved with the order.",
          "موعد متفق عليه مع المريض يدخله الموظف، وهو مستقل عن زمن إنجاز الفحوصات TAT. يُحفَظ توقيت الفرع مع الطلب.")}</small>
      </label>

      <label className="form-span">{tr("Patient", "المريض")}
        <input
          list="order-patient-options"
          placeholder={tr("Patient #, name or phone…", "رقم المريض أو الاسم أو الهاتف…")}
          value={patientSearch}
          onChange={e => {
            const value = e.target.value;
            setPatientSearch(value);
            const match = patientOptions.find(p => p.label === value);
            setPatientId(match?.id || "");
          }}
          required
          readOnly={Boolean(initialDoctorRequisition)}
        />
        <datalist id="order-patient-options">{patientOptions.map(p => <option key={p.id} value={p.label} />)}</datalist>
      </label>

      <label>{tr("Source", "المصدر")}
        <select name="sourceId" required defaultValue="">
          <option value="">{tr("Select source…", "اختر المصدر…")}</option>
          {sources.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn}</option>)}
        </select>
      </label>
      <label>{tr("Referrer", "المحيل")}
        <select name="referrerId" defaultValue={initialDoctorRequisition?.referrerId || ""}>
          <option value="">{tr("No referrer", "بدون محيل")}</option>
          {referrers.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn}</option>)}
        </select>
      </label>
      <label>{tr("Billing client", "عميل الفوترة")}
        <select name="clientId" defaultValue="">
          <option value="">{tr("Patient / default billing", "المريض / الفوترة الافتراضية")}</option>
          {clients.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn}</option>)}
        </select>
      </label>

      <label>{tr("Fasting", "صيام")}
        <select name="fasting" defaultValue=""><option value="">{tr("Unknown / not stated", "غير معروف / غير مذكور")}</option><option value="YES">{tr("Yes", "نعم")}</option><option value="NO">{tr("No", "لا")}</option></select>
      </label>
      <label>{tr("Diagnosis / indication", "التشخيص / سبب الطلب")}<input name="diagnosis" maxLength={500} defaultValue={initialDoctorRequisition?.diagnosis || ""} readOnly={Boolean(initialDoctorRequisition)} /></label>
      <label>{tr("Pregnancy status", "حالة الحمل")}
        <select
          name="pregnancyStatus"
          value={pregnancyStatus}
          onChange={event => setPregnancyStatus(event.target.value as "UNKNOWN" | "NOT_PREGNANT" | "PREGNANT")}
        >
          <option value="UNKNOWN">{tr("Unknown / not stated", "غير معروف / غير مذكور")}</option>
          <option value="NOT_PREGNANT">{tr("Not pregnant", "غير حامل")}</option>
          <option value="PREGNANT">{tr("Pregnant", "حامل")}</option>
        </select>
      </label>
      <label>{tr("Gestational age (weeks)", "عمر الحمل (بالأسابيع)")}
        <input
          name="gestationalAgeWeeks"
          type="number"
          min="0"
          step="0.01"
          disabled={pregnancyStatus !== "PREGNANT"}
          placeholder={pregnancyStatus === "PREGNANT" ? tr("Optional", "اختياري") : tr("Requires pregnant status", "يتطلب حالة حامل")}
        />
      </label>
      <label>{tr("Reference population code", "رمز المجموعة المرجعية")}
        <input name="referencePopulationCode" maxLength={80} placeholder={tr("Optional configured code", "رمز اختياري مُهيأ")} />
      </label>
      <label className="form-span">{tr("Pregnancy information", "معلومات الحمل")}<input name="pregnancyInfo" maxLength={500} /></label>
      <label className="form-span">{tr("Clinical notes", "ملاحظات سريرية")}<textarea name="clinicalNotes" rows={3} defaultValue={initialDoctorRequisition?.clinicalNotes || ""} readOnly={Boolean(initialDoctorRequisition)} /></label>

      <div className="form-span order-step-heading">
        <span className="order-step-index" aria-hidden="true">02</span>
        <div><strong>{tr("Tests and packages", "الفحوصات والباقات")}</strong>
          <p>{tr("Check for duplicates and confirm every requested test.", "تحقق من عدم تكرار الفحوصات وتأكد من كل فحص مطلوب.")}</p></div>
      </div>
      {packages.length > 0 && !initialDoctorRequisition && <div className="form-span order-test-picker">
        <label>{tr("Commercial packages", "الباقات التجارية")}
          <div className="inline-search">
            <input
              list="order-package-options"
              placeholder={tr("Type package code or name…", "اكتب رمز الباقة أو اسمها…")}
              value={packageSearch}
              onChange={e => setPackageSearch(e.target.value)}
            />
            <button className="secondary-button" type="button" onClick={addPackage}>{tr("Add Package", "إضافة باقة")}</button>
          </div>
          <datalist id="order-package-options">{packageOptions.map(pkg => <option key={pkg.id} value={pkg.label} />)}</datalist>
        </label>
        <div className="selected-test-list">
          {selectedPackages.length === 0 ? <span className="muted">{tr("No packages selected.", "لم يتم اختيار باقات.")}</span> :
            selectedPackages.map(pkg => <span className="selected-test-chip package-chip" key={pkg.id}>{pkg.code} — {pkg.nameEn} · {pkg.testIds.length} {tr("tests","فحوصات")}<button type="button" onClick={() => setSelectedPackageIds(ids => ids.filter(id => id !== pkg.id))}>×</button></span>)
          }
        </div>
        <p className="muted package-helper">{tr("Package members are ordered as individual clinical tests, while billing keeps the package price as one historical commercial snapshot.", "يتم طلب فحوصات الباقة كفحوصات سريرية منفصلة، بينما تحتفظ الفوترة بسعر الباقة كسجل تجاري تاريخي واحد.")}</p>
      </div>}

      <div className="form-span order-test-picker">
        <label>{tr("Tests", "الفحوصات")}
          <div className="inline-search">
            <input
              list="order-test-options"
              placeholder={tr("Type test code or name…", "اكتب رمز الفحص أو اسمه…")}
              value={testSearch}
              disabled={Boolean(initialDoctorRequisition)}
              onChange={e => setTestSearch(e.target.value)}
            />
            <button className="secondary-button" type="button" disabled={Boolean(initialDoctorRequisition)} onClick={addTest}>{tr("Add Test", "إضافة فحص")}</button>
          </div>
          <datalist id="order-test-options">{testOptions.map(test => <option key={test.id} value={test.label} />)}</datalist>
        </label>
        <div className="selected-test-list">
          {selectedTests.length === 0 ? <span className="muted">{tr("No tests selected.", "لم يتم اختيار فحوصات.")}</span> :
            selectedTests.map(test => {
              const fromPackage = packageTestIds.includes(test.id);
              return <span className={"selected-test-chip" + (fromPackage ? " package-member-chip" : "")} key={test.id}>
                {test.code} — {test.nameEn}{fromPackage ? " · " + tr("package", "باقة") : ""}
                {!fromPackage && !initialDoctorRequisition && <button type="button" onClick={() => setSelectedTestIds(ids => ids.filter(id => id !== test.id))}>×</button>}
              </span>;
            })
          }
        </div>
      </div>


      <div className="form-span order-step-heading">
        <span className="order-step-index" aria-hidden="true">03</span>
        <div><strong>{tr("Billing and discount", "الفوترة والخصم")}</strong>
          <p>{tr("Discount approval remains independent of clinical test selection.", "يبقى اعتماد الخصم منفصلًا عن اختيار الفحوصات السريرية.")}</p></div>
      </div>
      <div className="form-span order-question-panel">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">{tr("Billing control", "ضبط الفوترة")}</p>
            <h3>{tr("Order Discount", "خصم الطلب")}</h3>
          </div>
          <span className="keyboard-hint">{tr("Your self-approval limit", "حد الخصم المسموح لك")}: {discountLimitPercent.toFixed(2)}%</span>
        </div>
        <div className="form-grid">
          <label>{tr("Discount (%)", "الخصم (%)")}
            <input
              name="discountPercent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={discountPercent}
              onChange={event => {
                const value = Number(event.target.value);
                setDiscountPercent(Number.isFinite(value) ? value : 0);
                setDiscountApprovalRequestId("");
                setMessage("");
              }}
            />
          </label>
          {discountPercent > 0 && <label className="form-span">{tr("Discount reason", "سبب الخصم")}
            <input
              name="discountReason"
              maxLength={1000}
              required
              onChange={() => {
                if (discountApprovalRequestId) setDiscountApprovalRequestId("");
              }}
              placeholder={tr("Required for audit and approval", "مطلوب للتدقيق والاعتماد")}
            />
          </label>}
        </div>
        {discountPercent > discountLimitPercent && <div className="form-warning">
          <strong>{tr("Manager approval required", "مطلوب اعتماد مدير")}</strong>
          <p>{tr(
            "Submitting will create an approval request without creating the order. After an authorized manager approves it in Billing, submit the unchanged order again.",
            "عند الإرسال سيتم إنشاء طلب اعتماد دون إنشاء الطلب. بعد أن يعتمد مدير مخول الطلب من شاشة الفوترة، أعد إرسال الطلب نفسه دون تغيير.",
          )}</p>
          {discountApprovalRequestId && <small>{tr("Approval request", "طلب الاعتماد")}: {discountApprovalRequestId}</small>}
        </div>}
      </div>

      {selectedTests.some(test => test.orderQuestions.length > 0) && <div className="form-span order-step-heading">
        <span className="order-step-index" aria-hidden="true">04</span>
        <div><strong>{tr("Test-specific clinical questions", "الأسئلة السريرية الخاصة بالفحوصات")}</strong>
          <p>{tr("Required answers remain visible for the browser and server to validate.", "تبقى الإجابات الإلزامية ظاهرة ليتحقق منها المتصفح والخادم.")}</p></div>
      </div>}
      {selectedTests.some(test => test.orderQuestions.length > 0) && <div className="form-span order-question-panel">
        <div className="section-title-row">
          <div><p className="eyebrow">{tr("Clinical context", "السياق السريري")}</p><h3>{tr("Test-specific Questions", "أسئلة خاصة بالفحص")}</h3></div>
          <span className="keyboard-hint">{tr("Answers are saved with the ordered test", "تُحفظ الإجابات مع الفحص المطلوب")}</span>
        </div>
        <div className="order-question-grid">
          {selectedTests.flatMap(test => test.orderQuestions.map(question => <label key={question.id}>
            <span>{test.code} · {question.questionEn}{question.required ? " *" : ""}</span>
            {question.questionAr && <small dir="rtl">{question.questionAr}</small>}
            {question.responseType === "TEXT" && <input name={"question_" + question.id} required={question.required} />}
            {question.responseType === "NUMERIC" && <input name={"question_" + question.id} type="number" step="any" required={question.required} />}
            {question.responseType === "DATE" && <SystemDateField name={"question_" + question.id} required={question.required} />}
            {question.responseType === "DATETIME" && <input name={"question_" + question.id} type="datetime-local" required={question.required} />}
            {question.responseType === "BOOLEAN" && <select name={"question_" + question.id} required={question.required} defaultValue="">
              <option value="">{tr("Select…", "اختر…")}</option><option value="true">{tr("Yes", "نعم")}</option><option value="false">{tr("No", "لا")}</option>
            </select>}
            {question.responseType === "SINGLE_CHOICE" && <select name={"question_" + question.id} required={question.required} defaultValue="">
              <option value="">{tr("Select…", "اختر…")}</option>{question.options.map(option => <option key={option.code} value={option.code}>{locale === "ar" ? option.valueAr || option.valueEn : option.valueEn}</option>)}
            </select>}
          </label>))}
        </div>
      </div>}

      <div className="form-span order-compact-review" role="note">
        <strong>{tr("Final identity and billing check", "المراجعة النهائية للهوية والفوترة")}</strong>
        <p>{tr("Patient", "المريض")}: {patientId ? patientOptions.find(item => item.id === patientId)?.label || tr("Unrecognized selection", "اختيار غير معروف") : tr("Not selected", "لم يتم الاختيار")}</p>
        <p>{tr("Ordered tests", "الفحوصات المطلوبة")}: {selectedTests.length} {selectedTests.length > 0 ? "— " + selectedTests.map(item => item.code).join(", ") : ""}</p>
        <p>{tr("Commercial packages", "الباقات التجارية")}: {selectedPackages.length} {selectedPackages.length > 0 ? "— " + selectedPackages.map(item => item.code).join(", ") : ""}</p>
        <p>{tr("Discount", "الخصم")}: {discountPercent.toFixed(2)}%</p>
        <small>{tr(
          "Before submitting, review the ordering branch, the clinical answers, the selected billing client and any manager approval above. This action creates a laboratory order and may create an invoice.",
          "قبل الإرسال راجع فرع الطلب والإجابات السريرية وعميل الفوترة وأي اعتماد مدير أعلاه. هذا الإجراء ينشئ طلباً مخبرياً وقد ينشئ فاتورة.",
        )}</small>
      </div>
      {message && <div className={ambiguousSubmission ? "form-warning form-span" : "form-success form-span"} role={ambiguousSubmission ? "alert" : undefined}>{message}</div>}
      {ambiguousSubmission && <div className="form-warning form-span" role="alert">{tr(
        "Duplicate order protection is active. Saving is blocked for this session until you reload and reconcile the recorded order and invoice.",
        "حماية منع تكرار الطلبات مفعلة. الحفظ معطّل في هذه الجلسة إلى أن تعيد تحميل الصفحة وتتحقق من الطلب والفاتورة المسجلين.",
      )}</div>}
      <button className="primary-button form-span" disabled={busy || ambiguousSubmission}>{busy ? tr("Creating order…", "جارٍ إنشاء الطلب…") : tr("Register Order & Invoice", "تسجيل الطلب والفاتورة")}</button>
    </div>
  </form>;
}
