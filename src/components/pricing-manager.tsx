"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemIcon } from "@/components/system-icon";

type Option = { id: string; code: string; nameEn: string; nameAr?: string | null };
type ContractOption = Option & { clientId: string };
type TestOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
type PackageOption = { id: string; code: string; nameEn: string; nameAr?: string | null };
type PriceListOption = { id: string; code: string; nameEn: string; nameAr?: string | null; currency: string };

export function PricingManager({
  branches,
  clients,
  contracts,
  tests,
  packages,
  priceLists,
  defaultCurrency,
  locale,
}: {
  branches: Option[];
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
  const scopeLabel = (value: string) => ({ ORGANIZATION: tr("Organization","المؤسسة"), BRANCH: tr("Branch","الفرع"), CLIENT: tr("Client","العميل"), CONTRACT: tr("Contract","العقد") }[value] || value);
  const router = useRouter();
  const [scopeType, setScopeType] = useState("ORGANIZATION");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"contract" | "list" | "item" | "package" | "">("");
  const [testSearch, setTestSearch] = useState("");
  const [testId, setTestId] = useState("");
  const [packageSearch, setPackageSearch] = useState("");
  const [packageId, setPackageId] = useState("");
  const [open, setOpen] = useState<"contract" | "list" | "item" | "package" | "">("");

  const testOptions = useMemo(() => tests.map((test) => ({
    ...test,
    label: `${test.code} — ${localizedName(test)}`,
  })), [tests]);
  const packageOptions = useMemo(() => packages.map((pkg) => ({
    ...pkg,
    label: `${pkg.code} — ${localizedName(pkg)}`,
  })), [packages]);

  async function createContract(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("contract"); setMessage("");
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
    if (response.ok) {
      setMessage(`${tr("Contract created", "تم إنشاء العقد")}: ${body.contract.code}`);
      event.currentTarget.reset();
      router.refresh();
      setOpen("");
    } else setMessage(body.error || tr("Could not create contract.", "تعذر إنشاء العقد."));
    setBusy("");
  }

  async function createList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("list"); setMessage("");
    const response = await fetch("/api/pricing/price-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        scopeType,
        branchId: form.get("branchId"),
        clientId: form.get("clientId"),
        contractId: form.get("contractId"),
        currency: form.get("currency"),
        priority: Number(form.get("priority") || 0),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`${tr("Price list created", "تم إنشاء قائمة الأسعار")}: ${body.priceList.code}`);
      event.currentTarget.reset();
      setScopeType("ORGANIZATION");
      router.refresh();
      setOpen("");
    } else setMessage(body.error || tr("Could not create price list.", "تعذر إنشاء قائمة الأسعار."));
    setBusy("");
  }

  async function addPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!testId) { setMessage(tr("Select a valid test.", "اختر فحصًا صحيحًا.")); return; }
    setBusy("item"); setMessage("");
    const response = await fetch("/api/pricing/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceListId: form.get("priceListId"),
        testId,
        unitPrice: Number(form.get("unitPrice")),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("Test price added.", "تمت إضافة سعر الفحص."));
      setTestId(""); setTestSearch("");
      event.currentTarget.reset();
      router.refresh();
      setOpen("");
    } else setMessage(body.error || tr("Could not add test price.", "تعذر إضافة سعر الفحص."));
    setBusy("");
  }

  async function addPackagePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!packageId) { setMessage(tr("Select a valid package.", "اختر باقة صحيحة.")); return; }
    setBusy("package"); setMessage("");
    const response = await fetch("/api/pricing/package-items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceListId: form.get("priceListId"),
        packageId,
        unitPrice: Number(form.get("unitPrice")),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(tr("Package price added.", "تمت إضافة سعر الباقة."));
      setPackageId(""); setPackageSearch("");
      event.currentTarget.reset();
      router.refresh();
      setOpen("");
    } else setMessage(body.error || tr("Could not add package price.", "تعذر إضافة سعر الباقة."));
    setBusy("");
  }

  return <>
    <div className="crud-action-bar">
      <div>{message && <span className="crud-success-toast">{message}</span>}</div>
      <div className="crud-action-buttons">
        <button type="button" className="primary-button" onClick={() => { setMessage(""); setOpen("list"); }}><SystemIcon name="plus" size={16}/>{tr("New Price List", "قائمة أسعار جديدة")}</button>
        <button type="button" className="secondary-button" onClick={() => { setMessage(""); setOpen("contract"); }}><SystemIcon name="plus" size={16}/>{tr("New Contract", "عقد جديد")}</button>
        <button type="button" className="secondary-button" onClick={() => { setMessage(""); setOpen("item"); }}><SystemIcon name="plus" size={16}/>{tr("Add Test Price", "إضافة سعر فحص")}</button>
        <button type="button" className="secondary-button" onClick={() => { setMessage(""); setOpen("package"); }}><SystemIcon name="plus" size={16}/>{tr("Add Package Price", "إضافة سعر باقة")}</button>
      </div>
    </div>

    <CrudModal open={open === "contract"} onClose={() => setOpen("")} title={tr("Create Client Contract", "إنشاء عقد عميل")} description={tr("Create an effective-dated commercial contract for a client.", "إنشاء عقد تجاري للعميل بتاريخ سريان محدد.")} size="lg">
      <form className="catalog-form" onSubmit={createContract}>
        <label>{tr("Code", "الرمز")}<input name="code" placeholder={tr("Optional; generated from name","اختياري؛ يتم توليده من الاسم")} /></label>
        <label>{tr("Client", "العميل")}<select name="clientId" required><option value="">{tr("Select client…", "اختر العميل…")}</option>{clients.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)}</option>)}</select></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label>{tr("Name (Arabic)","الاسم بالعربية")}<input name="nameAr" dir="rtl" /></label>
        <label>{tr("Currency", "العملة")}<input name="currency" required maxLength={3} defaultValue={defaultCurrency} /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "contract"}>{busy === "contract" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Contract", "إنشاء العقد")}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "list"} onClose={() => setOpen("")} title={tr("Create Price List", "إنشاء قائمة أسعار")} description={tr("Define pricing scope, currency, precedence and effective dates.", "حدد نطاق التسعير والعملة والأولوية وتواريخ السريان.")} size="lg">
      <form className="catalog-form" onSubmit={createList}>
        <label>{tr("Code", "الرمز")}<input name="code" placeholder={tr("Optional; generated from name","اختياري؛ يتم توليده من الاسم")} /></label>
        <label>{tr("Scope", "النطاق")}<select value={scopeType} onChange={e => setScopeType(e.target.value)}><option value="ORGANIZATION">{scopeLabel("ORGANIZATION")}</option><option value="BRANCH">{scopeLabel("BRANCH")}</option><option value="CLIENT">{scopeLabel("CLIENT")}</option><option value="CONTRACT">{scopeLabel("CONTRACT")}</option></select></label>
        <label>{tr("Name (English)", "الاسم بالإنجليزية")}<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        {scopeType === "BRANCH" && <label>{tr("Branch", "الفرع")}<select name="branchId" required><option value="">{tr("Select branch…", "اختر الفرع…")}</option>{branches.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)}</option>)}</select></label>}
        {scopeType === "CLIENT" && <label>{tr("Client", "العميل")}<select name="clientId" required><option value="">{tr("Select client…", "اختر العميل…")}</option>{clients.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)}</option>)}</select></label>}
        {scopeType === "CONTRACT" && <label>{tr("Contract", "العقد")}<select name="contractId" required><option value="">{tr("Select contract…", "اختر العقد…")}</option>{contracts.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)}</option>)}</select></label>}
        <label>{tr("Currency", "العملة")}<input name="currency" required maxLength={3} defaultValue={defaultCurrency} /></label>
        <label>{tr("Priority", "الأولوية")}<input name="priority" type="number" defaultValue="0" /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "list"}>{busy === "list" ? tr("Saving…", "جارٍ الحفظ…") : tr("Create Price List", "إنشاء قائمة الأسعار")}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "item"} onClose={() => setOpen("")} title={tr("Add Test Price", "إضافة سعر فحص")} description={tr("Add an effective-dated test price to a price list.", "أضف سعر فحص بتاريخ سريان إلى قائمة الأسعار.")} size="md">
      <form className="catalog-form" onSubmit={addPrice}>
        <label className="form-span">{tr("Price list", "قائمة الأسعار")}<select name="priceListId" required><option value="">{tr("Select price list…", "اختر قائمة الأسعار…")}</option>{priceLists.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)} ({x.currency})</option>)}</select></label>
        <label className="form-span">{tr("Test", "الفحص")}
          <input list="pricing-test-options" placeholder={tr("Type test code or name…", "اكتب رمز الفحص أو اسمه…")} value={testSearch} onChange={e => { const value=e.target.value; setTestSearch(value); const match=testOptions.find(x=>x.label===value); setTestId(match?.id || ""); }} required />
          <datalist id="pricing-test-options">{testOptions.map(test => <option key={test.id} value={test.label} />)}</datalist>
        </label>
        <label>{tr("Unit price", "سعر الوحدة")}<input name="unitPrice" type="number" step="0.0001" min="0" required /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "item"}>{busy === "item" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Test Price", "إضافة سعر الفحص")}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "package"} onClose={() => setOpen("")} title={tr("Add Package Price", "إضافة سعر باقة")} description={tr("Package pricing remains independent from member-test pricing.", "يبقى سعر الباقة مستقلاً عن أسعار الفحوصات المكونة لها.")} size="md">
      <form className="catalog-form" onSubmit={addPackagePrice}>
        <label className="form-span">{tr("Price list", "قائمة الأسعار")}<select name="priceListId" required><option value="">{tr("Select price list…", "اختر قائمة الأسعار…")}</option>{priceLists.map(x => <option key={x.id} value={x.id}>{x.code} — {localizedName(x)} ({x.currency})</option>)}</select></label>
        <label className="form-span">{tr("Commercial package", "الباقة التجارية")}
          <input list="pricing-package-options" placeholder={tr("Type package code or name…", "اكتب رمز الباقة أو اسمها…")} value={packageSearch} onChange={e => { const value=e.target.value; setPackageSearch(value); const match=packageOptions.find(x=>x.label===value); setPackageId(match?.id || ""); }} required />
          <datalist id="pricing-package-options">{packageOptions.map(pkg => <option key={pkg.id} value={pkg.label} />)}</datalist>
        </label>
        <label>{tr("Package price", "سعر الباقة")}<input name="unitPrice" type="number" step="0.0001" min="0" required /></label>
        <label>{tr("Effective from", "ساري من")}<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>{tr("Effective to", "ساري حتى")}<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "package"}>{busy === "package" ? tr("Saving…", "جارٍ الحفظ…") : tr("Add Package Price", "إضافة سعر الباقة")}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>
  </>;
}
