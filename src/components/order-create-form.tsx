"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PatientOption = { id: string; patientNumber: string; fullNameEn: string; phone: string | null };
type OrderQuestionOption = {
  id: string;
  code: string;
  questionEn: string;
  questionAr: string | null;
  responseType: "TEXT" | "NUMERIC" | "BOOLEAN" | "DATE" | "SINGLE_CHOICE";
  required: boolean;
  options: string[];
  displayOrder: number;
};
type TestOption = { id: string; code: string; nameEn: string; orderQuestions: OrderQuestionOption[] };
type PackageOption = { id: string; code: string; nameEn: string; testIds: string[] };
type SimpleOption = { id: string; code: string; nameEn: string };
type ReferrerOption = SimpleOption & { clientId: string | null };
type SourceOption = SimpleOption & { category: string };
type BranchOption = SimpleOption;

export function OrderCreateForm({
  patients,
  tests,
  packages,
  clients,
  referrers,
  sources,
  branches,
  activeBranchId,
  locale,
  onSuccess,
}: {
  patients: PatientOption[];
  tests: TestOption[];
  packages: PackageOption[];
  clients: SimpleOption[];
  referrers: ReferrerOption[];
  sources: SourceOption[];
  branches: BranchOption[];
  activeBranchId: string | null;
  locale: "ar" | "en";
  onSuccess?: (message: string) => void;
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const router = useRouter();
  const [patientSearch, setPatientSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [testSearch, setTestSearch] = useState("");
  const [selectedTestIds, setSelectedTestIds] = useState<string[]>([]);
  const [packageSearch, setPackageSearch] = useState("");
  const [selectedPackageIds, setSelectedPackageIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

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
    if (!patientId) { setMessage(tr("Select a valid patient.", "اختر مريضًا صحيحًا.")); return; }
    if (effectiveTestIds.length === 0) { setMessage(tr("Add at least one test or commercial package.", "أضف فحصًا واحدًا أو باقة تجارية واحدة على الأقل.")); return; }

    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");

    const fastingValue = form.get("fasting");
    const fasting = fastingValue === "YES" ? true : fastingValue === "NO" ? false : null;
    const answers = selectedTests.flatMap(test => test.orderQuestions.map(question => ({
      questionId: question.id,
      value: form.get("question_" + question.id),
    })));

    const response = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        branchId: form.get("branchId"),
        patientId,
        sourceId: form.get("sourceId"),
        referrerId: form.get("referrerId"),
        clientId: form.get("clientId"),
        priority: form.get("priority"),
        fasting,
        diagnosis: form.get("diagnosis"),
        clinicalNotes: form.get("clinicalNotes"),
        pregnancyInfo: form.get("pregnancyInfo"),
        testIds: selectedTestIds,
        packageIds: selectedPackageIds,
        answers,
      }),
    });

    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      const success = `${tr("Order", "الطلب")} ${body.accessionNumber} ${tr("created", "تم إنشاؤه")} · ${tr("Invoice", "الفاتورة")} ${body.invoiceNumber} · ${body.total} ${body.currency}`;
      setMessage(success);
      setPatientId("");
      setPatientSearch("");
      setSelectedTestIds([]);
      setSelectedPackageIds([]);
      setPackageSearch("");
      event.currentTarget.reset();
      router.refresh();
      onSuccess?.(success);
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
    setBusy(false);
  }

  return <form className="order-form" onSubmit={submit}>
    <div className="form-grid">
      <label>{tr("Ordering branch", "فرع الطلب")}
        <select name="branchId" required defaultValue={activeBranchId || ""}>
          <option value="">{tr("Select branch…", "اختر الفرع…")}</option>
          {branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}
        </select>
      </label>
      <label>{tr("Priority", "الأولوية")}
        <select name="priority" defaultValue="ROUTINE"><option value="ROUTINE">{tr("Routine", "عادي")}</option><option value="URGENT">{tr("Urgent", "عاجل")}</option><option value="STAT">{tr("STAT", "فوري")}</option></select>
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
        <select name="referrerId" defaultValue="">
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
      <label>{tr("Diagnosis / indication", "التشخيص / سبب الطلب")}<input name="diagnosis" maxLength={500} /></label>
      <label className="form-span">{tr("Pregnancy information", "معلومات الحمل")}<input name="pregnancyInfo" maxLength={500} /></label>
      <label className="form-span">{tr("Clinical notes", "ملاحظات سريرية")}<textarea name="clinicalNotes" rows={3} /></label>

      {packages.length > 0 && <div className="form-span order-test-picker">
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
            selectedPackages.map(pkg => <span className="selected-test-chip package-chip" key={pkg.id}>{pkg.code} — {pkg.nameEn} · {pkg.testIds.length} tests<button type="button" onClick={() => setSelectedPackageIds(ids => ids.filter(id => id !== pkg.id))}>×</button></span>)
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
              onChange={e => setTestSearch(e.target.value)}
            />
            <button className="secondary-button" type="button" onClick={addTest}>{tr("Add Test", "إضافة فحص")}</button>
          </div>
          <datalist id="order-test-options">{testOptions.map(test => <option key={test.id} value={test.label} />)}</datalist>
        </label>
        <div className="selected-test-list">
          {selectedTests.length === 0 ? <span className="muted">{tr("No tests selected.", "لم يتم اختيار فحوصات.")}</span> :
            selectedTests.map(test => {
              const fromPackage = packageTestIds.includes(test.id);
              return <span className={"selected-test-chip" + (fromPackage ? " package-member-chip" : "")} key={test.id}>
                {test.code} — {test.nameEn}{fromPackage ? " · " + tr("package", "باقة") : ""}
                {!fromPackage && <button type="button" onClick={() => setSelectedTestIds(ids => ids.filter(id => id !== test.id))}>×</button>}
              </span>;
            })
          }
        </div>
      </div>


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
            {question.responseType === "DATE" && <input name={"question_" + question.id} type="date" required={question.required} />}
            {question.responseType === "BOOLEAN" && <select name={"question_" + question.id} required={question.required} defaultValue="">
              <option value="">{tr("Select…", "اختر…")}</option><option value="true">{tr("Yes", "نعم")}</option><option value="false">{tr("No", "لا")}</option>
            </select>}
            {question.responseType === "SINGLE_CHOICE" && <select name={"question_" + question.id} required={question.required} defaultValue="">
              <option value="">{tr("Select…", "اختر…")}</option>{question.options.map(option => <option key={option} value={option}>{option}</option>)}
            </select>}
          </label>))}
        </div>
      </div>}

      {message && <div className="form-success form-span">{message}</div>}
      <button className="primary-button form-span" disabled={busy}>{busy ? tr("Creating order…", "جارٍ إنشاء الطلب…") : tr("Register Order & Invoice", "تسجيل الطلب والفاتورة")}</button>
    </div>
  </form>;
}
