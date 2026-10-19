"use client";

import { SystemDateField } from "@/components/system-date-field";

import { FormEvent, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemIcon } from "@/components/system-icon";

type Option = { id: string; code: string; nameEn: string; nameAr?: string | null };
type SourceOption = Option & { category: string };
type ContractOption = Option & { clientId: string };
type TestOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
type PackageOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
type PriceListOption = { id: string; code: string; nameEn: string; nameAr?: string | null; currency: string };

export function PricingManager({
  branches,
  sources,
  referrers,
  clients,
  contracts,
  tests,
  packages,
  priceLists,
  defaultCurrency,
  locale,
}: {
  branches: Option[];
  sources: SourceOption[];
  referrers: Option[];
  clients: Option[];
  contracts: ContractOption[];
  tests: TestOption[];
  packages: PackageOption[];
  priceLists: PriceListOption[];
  defaultCurrency: string;
  locale: "ar" | "en";
}) {
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const localizedName = (item: { nameEn: string; nameAr?: string | null }) => locale === "ar" ? item.nameAr || item.nameEn : item.nameEn;
  const scopeLabel = (value: string) => ({ ORGANIZATION: tr("Organization","المؤسسة"), BRANCH: tr("Branch","الفرع"), SOURCE: tr("Source / Campaign","المصدر / الحملة"), REFERRER: tr("Referrer / Doctor","المحيل / الطبيب"), CLIENT: tr("Client","العميل"), CONTRACT: tr("Contract","العقد") }[value] || value);
  const router = useRouter();
  const [scopeType, setScopeType] = useState("ORGANIZATION");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"contract" | "list" | "item" | "package" | "">("");
  const submitting = useRef(false);
  const [isError, setIsError] = useState(false);
  const [testSearch, setTestSearch] = useState("");
  const [testId, setTestId] = useState("");
  const [packageSearch, setPackageSearch] = useState("");
  const [packageId, setPackageId] = useState("");
  const [open, setOpen] = useState<"contract" | "list" | "item" | "package" | "">("");

  const testOptions = useMemo(() => tests.map((test) => ({
    ...test,
    label: `${test.code} — ${localizedName(test)}`,
  })), [tests, locale]);
  const packageOptions = useMemo(() => packages.map((pkg) => ({
    ...pkg,
    label: `${pkg.code} — ${localizedName(pkg)}`,
  })), [packages, locale]);

  async function createContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    submitting.current = true;
    setBusy("contract"); setMessage(""); setIsError(false);
    try {
    const response = await fetch("/api/pricing/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        clientId: form.get("clientId"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        currency: form.get("currency"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setIsError(!response.ok);
    if (response.ok) {
      setMessage(`${tr("Contract created", "تم إنشاء العقد")}: ${body.contract.code}`);
      formElement.reset();
      router.refresh();
      setOpen("");
    } else setMessage(body.error || tr("Could not create contract.", "تعذر إنشاء العقد."));
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Verify existing contracts and price revisions before retrying.",
        "انقطع الاتصال. تحقق من العقود ونسخ الأسعار السابقة قبل إعادة المحاولة.",
      ));
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  async function createList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    submitting.current = true;
    setBusy("list"); setMessage(""); setIsError(false);
    try {
    const response = await fetch("/api/pricing/price-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        scopeType,
        branchId: form.get("branchId"),
        sourceId: form.get("sourceId"),
        referrerId: form.get("referrerId"),
        clientId: form.get("clientId"),
        contractId: form.get("contractId"),
        currency: form.get("currency"),
        priority: Number(form.get("priority") || 0),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setIsError(!response.ok);
    if (response.ok) {
      setMessage(`${tr("Price list created", "تم إنشاء قائمة الأسعار")}: ${body.priceList.code}`);
      formElement.reset();
      setScopeType("ORGANIZATION");
      router.refresh();
      setOpen("");
    } else setMessage(body.error === "price_list_precedence_conflict"
      ? tr(
          "Another price list already has the same scope, target, priority and start date. Change the start date or priority.",
          "توجد قائمة أسعار أخرى بنفس النطاق والهدف والأولوية وتاريخ البداية. غيّر تاريخ البداية أو الأولوية.",
        )
      : body.error || tr("Could not create price list.", "تعذر إنشاء قائمة الأسعار."));
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Verify existing contracts and price revisions before retrying.",
        "انقطع الاتصال. تحقق من العقود ونسخ الأسعار السابقة قبل إعادة المحاولة.",
      ));
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  async function addPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!testId) { setMessage(tr("Select a valid test.", "اختر فحصًا صحيحًا.")); return; }
    submitting.current = true;
    setBusy("item"); setMessage(""); setIsError(false);
    try {
    const response = await fetch("/api/pricing/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceListId: form.get("priceListId"),
        testId,
        unitPrice: form.get("unitPrice"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setIsError(!response.ok);
    if (response.ok) {
      const superseded = Number(body.supersededCount || 0);
      setMessage(superseded > 0
        ? tr("New test price revision added; the previous effective price was closed automatically.", "تمت إضافة نسخة سعر جديدة للفحص وإغلاق السعر السابق تلقائيًا.")
        : tr("Test price added.", "تمت إضافة سعر الفحص."));
      setTestId(""); setTestSearch("");
      formElement.reset();
      router.refresh();
      setOpen("");
    } else setMessage(body.error === "price_revision_must_start_after_latest"
      ? tr("The new price must start after the latest existing revision.", "يجب أن يبدأ السعر الجديد بعد أحدث نسخة سعر موجودة.")
      : body.error === "invalid_exact_price"
        ? tr("Enter an exact non-negative price with up to 14 whole digits and four decimal places.", "أدخل سعراً دقيقاً غير سالب، بحد أقصى 14 رقماً صحيحاً وأربع خانات عشرية.")
        : body.error || tr("Could not add test price.", "تعذر إضافة سعر الفحص."));
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Verify existing contracts and price revisions before retrying.",
        "انقطع الاتصال. تحقق من العقود ونسخ الأسعار السابقة قبل إعادة المحاولة.",
      ));
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  async function addPackagePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!packageId) { setMessage(tr("Select a valid package.", "اختر باقة صحيحة.")); return; }
    submitting.current = true;
    setBusy("package"); setMessage(""); setIsError(false);
    try {
    const response = await fetch("/api/pricing/package-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceListId: form.get("priceListId"),
        packageId,
        unitPrice: form.get("unitPrice"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    setIsError(!response.ok);
    if (response.ok) {
      const superseded = Number(body.supersededCount || 0);
      setMessage(superseded > 0
        ? tr("New package price revision added; the previous effective price was closed automatically.", "تمت إضافة نسخة سعر جديدة للباقة وإغلاق السعر السابق تلقائيًا.")
        : tr("Package price added.", "تمت إضافة سعر الباقة."));
      setPackageId(""); setPackageSearch("");
      formElement.reset();
      router.refresh();
      setOpen("");
    } else setMessage(body.error === "price_revision_must_start_after_latest"
      ? tr("The new price must start after the latest existing revision.", "يجب أن يبدأ السعر الجديد بعد أحدث نسخة سعر موجودة.")
      : body.error === "invalid_exact_price"
        ? tr("Enter an exact non-negative price with up to 14 whole digits and four decimal places.", "أدخل سعراً دقيقاً غير سالب، بحد أقصى 14 رقماً صحيحاً وأربع خانات عشرية.")
        : body.error || tr("Could not add package price.", "تعذر إضافة سعر الباقة."));
    } catch {
      setIsError(true);
      setMessage(tr(
        "Connection interrupted. Verify existing contracts and price revisions before retrying.",
        "انقطع الاتصال. تحقق من العقود ونسخ الأسعار السابقة قبل إعادة المحاولة.",
      ));
    } finally {
      submitting.current = false;
      setBusy("");
    }
  }

  return <>
    <div className="crud-action-bar">
      <div>{message && !isError && <span className="crud-success-toast" role="status">{message}</span>}</div>
      <div className="crud-action-buttons">
        <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => { setIsError(false); setMessage(""); setOpen("list"); }}><SystemIcon name="plus" size={16}/>{tr("New Price List", "قائمة أسعار جديدة")}</button>
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => { setIsError(false); setMessage(""); setOpen("contract"); }}><SystemIcon name="plus" size={16}/>{tr("New Contract", "عقد جديد")}</button>
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => { setIsError(false); setMessage(""); setOpen("item"); }}><SystemIcon name="plus" size={16}/>{tr("Add Test Price", "إضافة سعر فحص")}</button>
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => { setIsError(false); setMessage(""); setOpen("package"); }}><SystemIcon name="plus" size={16}/>{tr("Add Package Price", "إضافة سعر باقة")}</button>
      </div>
    </div>

    <CrudModal open={open === "contract"} onClose={() => { if (!submitting.current) setOpen(""); }} title={tr("Create Client Contract", "إنشاء عقد عميل")} description={tr("Create an effective-dated commercial contract for a client.", "إنشاء عقد تجاري للعميل بتاريخ سريان محدد.")} size="compact">
      <form className="catalog-form" onSubmit={createContract}>
        <label>{tr("Code", "الرمز")}<input name="code" placeholder={tr("Optional; generated from name","اختياري؛ يتم توليده من الاسم")} /></label>
        <label>{tr("Client", "العميل")}<select name="clientId" required><option value="">{tr("Select client…", "اختر العميل…")}</option>{clients.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)}</option>)}</select></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Name (Arabic)","الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <label>{tr("Currency", "العملة")}<input name="currency" required maxLength={3} defaultValue={defaultCurrency} /></label>
        <label>{tr("Effective from (select intended local date)", "ساري من (اختر التاريخ المحلي المقصود)")}<SystemDateField name="effectiveFrom" required /></label>
        <label>{tr("Effective to", "ساري حتى")}<SystemDateField name="effectiveTo" /></label>
        <button className="primary-button form-span" disabled={busy === "contract"}>{busy === "contract" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Contract", "إنشاء العقد")}</button>
        {message && <div className={(isError ? "form-error" : "form-success") + " form-span"} role={isError ? "alert" : "status"}>{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "list"} onClose={() => { if (!submitting.current) setOpen(""); }} title={tr("Create Price List", "إنشاء قائمة أسعار")} description={tr("Define pricing scope, currency, precedence and effective dates.", "حدد نطاق التسعير والعملة والأولوية وتواريخ السريان.")} size="compact">
      <form className="catalog-form" onSubmit={createList}>
        <label>{tr("Code", "الرمز")}<input name="code" placeholder={tr("Optional; generated from name","اختياري؛ يتم توليده من الاسم")} /></label>
        <label>{tr("Scope", "النطاق")}<select value={scopeType} onChange={e => setScopeType(e.target.value)}><option value="ORGANIZATION">{scopeLabel("ORGANIZATION")}</option><option value="BRANCH">{scopeLabel("BRANCH")}</option><option value="SOURCE">{scopeLabel("SOURCE")}</option><option value="REFERRER">{scopeLabel("REFERRER")}</option><option value="CLIENT">{scopeLabel("CLIENT")}</option><option value="CONTRACT">{scopeLabel("CONTRACT")}</option></select></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Name (Arabic)", "الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        {scopeType === "BRANCH" && <label>{tr("Branch", "الفرع")}<select name="branchId" required><option value="">{tr("Select branch…", "اختر الفرع…")}</option>{branches.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)}</option>)}</select></label>}
        {scopeType === "SOURCE" && <label>{tr("Source / Campaign", "المصدر / الحملة")}<select name="sourceId" required><option value="">{tr("Select source or campaign…", "اختر المصدر أو الحملة…")}</option>{sources.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)} · {x.category}</option>)}</select></label>}
        {scopeType === "REFERRER" && <label>{tr("Referrer / Doctor", "المحيل / الطبيب")}<select name="referrerId" required><option value="">{tr("Select referrer or doctor…", "اختر المحيل أو الطبيب…")}</option>{referrers.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)}</option>)}</select></label>}
        {scopeType === "CLIENT" && <label>{tr("Client", "العميل")}<select name="clientId" required><option value="">{tr("Select client…", "اختر العميل…")}</option>{clients.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)}</option>)}</select></label>}
        {scopeType === "CONTRACT" && <label>{tr("Contract", "العقد")}<select name="contractId" required><option value="">{tr("Select contract…", "اختر العقد…")}</option>{contracts.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)}</option>)}</select></label>}
        <label>{tr("Currency", "العملة")}<input name="currency" required maxLength={3} defaultValue={defaultCurrency} /></label>
        <label>{tr("Priority", "الأولوية")}<input name="priority" type="number" defaultValue="0" /></label>
        <label>{tr("Effective from (select intended local date)", "ساري من (اختر التاريخ المحلي المقصود)")}<SystemDateField name="effectiveFrom" required /></label>
        <label>{tr("Effective to", "ساري حتى")}<SystemDateField name="effectiveTo" /></label>
        <button className="primary-button form-span" disabled={busy === "list"}>{busy === "list" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Price List", "إنشاء قائمة الأسعار")}</button>
        {message && <div className={(isError ? "form-error" : "form-success") + " form-span"} role={isError ? "alert" : "status"}>{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "item"} onClose={() => { if (!submitting.current) setOpen(""); }} title={tr("Add Test Price", "إضافة سعر فحص")} description={tr("Add an effective-dated test price to a price list.", "أضف سعر فحص بتاريخ سريان إلى قائمة الأسعار.")} size="compact">
      <form className="catalog-form" onSubmit={addPrice}>
        <label className="form-span">{tr("Price list", "قائمة الأسعار")}<select name="priceListId" required><option value="">{tr("Select price list…", "اختر قائمة الأسعار…")}</option>{priceLists.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)} ({x.currency})</option>)}</select></label>
        <label className="form-span">{tr("Test", "الفحص")}
          <input list="pricing-test-options" placeholder={tr("Type test code or name…", "اكتب رمز الفحص أو اسمه…")} value={testSearch} onChange={e => { const value=e.target.value; setTestSearch(value); const match=testOptions.find(x=>x.label===value); setTestId(match?.id || ""); }} required />
          <datalist id="pricing-test-options">{testOptions.map(test => <option key={test.id} value={test.label} />)}</datalist>
        </label>
        <label>{tr("Unit price", "سعر الوحدة")}<input name="unitPrice" type="text" inputMode="decimal" pattern="(0|[1-9][0-9]{0,13})(\\.[0-9]{1,4})?" maxLength={19} title={tr("Enter a non-negative decimal with at most four digits after the dot (no separators).", "أدخل قيمة غير سالبة وبحد أقصى أربع خانات بعد النقطة، من دون فواصل.")} autoComplete="off" spellCheck={false} required /></label>
        <label>{tr("Effective from (select intended local date)", "ساري من (اختر التاريخ المحلي المقصود)")}<SystemDateField name="effectiveFrom" required /></label>
        <label>{tr("Effective to", "ساري حتى")}<SystemDateField name="effectiveTo" /></label>
        <button className="primary-button form-span" disabled={busy === "item"}>{busy === "item" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Test Price", "إضافة سعر الفحص")}</button>
        {message && <div className={(isError ? "form-error" : "form-success") + " form-span"} role={isError ? "alert" : "status"}>{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "package"} onClose={() => { if (!submitting.current) setOpen(""); }} title={tr("Add Package Price", "إضافة سعر باقة")} description={tr("Package pricing remains independent from member-test pricing.", "يبقى سعر الباقة مستقلاً عن أسعار الفحوصات المكونة لها.")} size="compact">
      <form className="catalog-form" onSubmit={addPackagePrice}>
        <label className="form-span">{tr("Price list", "قائمة الأسعار")}<select name="priceListId" required><option value="">{tr("Select price list…", "اختر قائمة الأسعار…")}</option>{priceLists.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)} ({x.currency})</option>)}</select></label>
        <label className="form-span">{tr("Commercial package", "الباقة التجارية")}
          <input list="pricing-package-options" placeholder={tr("Type package code or name…", "اكتب رمز الباقة أو اسمها…")} value={packageSearch} onChange={e => { const value=e.target.value; setPackageSearch(value); const match=packageOptions.find(x=>x.label===value); setPackageId(match?.id || ""); }} required />
          <datalist id="pricing-package-options">{packageOptions.map(pkg => <option key={pkg.id} value={pkg.label} />)}</datalist>
        </label>
        <label>{tr("Package price", "سعر الباقة")}<input name="unitPrice" type="text" inputMode="decimal" pattern="(0|[1-9][0-9]{0,13})(\\.[0-9]{1,4})?" maxLength={19} title={tr("Enter a non-negative decimal with at most four digits after the dot (no separators).", "أدخل قيمة غير سالبة وبحد أقصى أربع خانات بعد النقطة، من دون فواصل.")} autoComplete="off" spellCheck={false} required /></label>
        <label>{tr("Effective from (select intended local date)", "ساري من (اختر التاريخ المحلي المقصود)")}<SystemDateField name="effectiveFrom" required /></label>
        <label>{tr("Effective to", "ساري حتى")}<SystemDateField name="effectiveTo" /></label>
        <button className="primary-button form-span" disabled={busy === "package"}>{busy === "package" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Package Price", "إضافة سعر الباقة")}</button>
        {message && <div className={(isError ? "form-error" : "form-success") + " form-span"} role={isError ? "alert" : "status"}>{message}</div>}
      </form>
    </CrudModal>
  </>;
}
