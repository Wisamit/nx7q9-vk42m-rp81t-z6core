"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CrudModal } from "@/components/crud-modal";
import { SystemIcon } from "@/components/system-icon";

type Option = { id: string; code: string; nameEn: string };
type ContractOption = Option & { clientId: string };
type TestOption = { id: string; code: string; nameEn: string };
type PackageOption = { id: string; code: string; nameEn: string };
type PriceListOption = { id: string; code: string; nameEn: string; currency: string };

export function PricingManager({
  branches,
  clients,
  contracts,
  tests,
  packages,
  priceLists,
  defaultCurrency,
}: {
  branches: Option[];
  clients: Option[];
  contracts: ContractOption[];
  tests: TestOption[];
  packages: PackageOption[];
  priceLists: PriceListOption[];
  defaultCurrency: string;
}) {
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
    label: `${test.code} — ${test.nameEn}`,
  })), [tests]);
  const packageOptions = useMemo(() => packages.map((pkg) => ({
    ...pkg,
    label: `${pkg.code} — ${pkg.nameEn}`,
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
      setMessage(`Contract created: ${body.contract.code}`);
      event.currentTarget.reset();
      router.refresh();
      setOpen("");
    } else setMessage(body.error || "Could not create contract.");
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
      setMessage(`Price list created: ${body.priceList.code}`);
      event.currentTarget.reset();
      setScopeType("ORGANIZATION");
      router.refresh();
      setOpen("");
    } else setMessage(body.error || "Could not create price list.");
    setBusy("");
  }

  async function addPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!testId) { setMessage("Select a valid test."); return; }
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
      setMessage("Test price added.");
      setTestId(""); setTestSearch("");
      event.currentTarget.reset();
      router.refresh();
      setOpen("");
    } else setMessage(body.error || "Could not add test price.");
    setBusy("");
  }

  async function addPackagePrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!packageId) { setMessage("Select a valid package."); return; }
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
      setMessage("Package price added.");
      setPackageId(""); setPackageSearch("");
      event.currentTarget.reset();
      router.refresh();
      setOpen("");
    } else setMessage(body.error || "Could not add package price.");
    setBusy("");
  }

  return <>
    <div className="crud-action-bar">
      <div>{message && <span className="crud-success-toast">{message}</span>}</div>
      <div className="crud-action-buttons">
        <button type="button" className="primary-button" onClick={() => { setMessage(""); setOpen("list"); }}><SystemIcon name="plus" size={16}/>New Price List</button>
        <button type="button" className="secondary-button" onClick={() => { setMessage(""); setOpen("contract"); }}><SystemIcon name="plus" size={16}/>New Contract</button>
        <button type="button" className="secondary-button" onClick={() => { setMessage(""); setOpen("item"); }}><SystemIcon name="plus" size={16}/>Add Test Price</button>
        <button type="button" className="secondary-button" onClick={() => { setMessage(""); setOpen("package"); }}><SystemIcon name="plus" size={16}/>Add Package Price</button>
      </div>
    </div>

    <CrudModal open={open === "contract"} onClose={() => setOpen("")} title="Create Client Contract" description="Create an effective-dated commercial contract for a client." size="lg">
      <form className="catalog-form" onSubmit={createContract}>
        <label>Code<input name="code" placeholder="Optional; generated from name" /></label>
        <label>Client<select name="clientId" required><option value="">Select client…</option>{clients.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn}</option>)}</select></label>
        <label>Name (English)<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <label>Currency<input name="currency" required maxLength={3} defaultValue={defaultCurrency} /></label>
        <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "contract"}>{busy === "contract" ? "Saving…" : "Create Contract"}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "list"} onClose={() => setOpen("")} title="Create Price List" description="Define pricing scope, currency, precedence and effective dates." size="lg">
      <form className="catalog-form" onSubmit={createList}>
        <label>Code<input name="code" placeholder="Optional; generated from name" /></label>
        <label>Scope<select value={scopeType} onChange={e => setScopeType(e.target.value)}><option>ORGANIZATION</option><option>BRANCH</option><option>CLIENT</option><option>CONTRACT</option></select></label>
        <label>Name (English)<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        {scopeType === "BRANCH" && <label>Branch<select name="branchId" required><option value="">Select branch…</option>{branches.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn}</option>)}</select></label>}
        {scopeType === "CLIENT" && <label>Client<select name="clientId" required><option value="">Select client…</option>{clients.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn}</option>)}</select></label>}
        {scopeType === "CONTRACT" && <label>Contract<select name="contractId" required><option value="">Select contract…</option>{contracts.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn}</option>)}</select></label>}
        <label>Currency<input name="currency" required maxLength={3} defaultValue={defaultCurrency} /></label>
        <label>Priority<input name="priority" type="number" defaultValue="0" /></label>
        <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "list"}>{busy === "list" ? "Saving…" : "Create Price List"}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "item"} onClose={() => setOpen("")} title="Add Test Price" description="Add an effective-dated test price to a price list." size="md">
      <form className="catalog-form" onSubmit={addPrice}>
        <label className="form-span">Price list<select name="priceListId" required><option value="">Select price list…</option>{priceLists.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn} ({x.currency})</option>)}</select></label>
        <label className="form-span">Test
          <input list="pricing-test-options" placeholder="Type test code or name…" value={testSearch} onChange={e => { const value=e.target.value; setTestSearch(value); const match=testOptions.find(x=>x.label===value); setTestId(match?.id || ""); }} required />
          <datalist id="pricing-test-options">{testOptions.map(test => <option key={test.id} value={test.label} />)}</datalist>
        </label>
        <label>Unit price<input name="unitPrice" type="number" step="0.0001" min="0" required /></label>
        <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "item"}>{busy === "item" ? "Saving…" : "Add Test Price"}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>

    <CrudModal open={open === "package"} onClose={() => setOpen("")} title="Add Package Price" description="Package pricing remains independent from member-test pricing." size="md">
      <form className="catalog-form" onSubmit={addPackagePrice}>
        <label className="form-span">Price list<select name="priceListId" required><option value="">Select price list…</option>{priceLists.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn} ({x.currency})</option>)}</select></label>
        <label className="form-span">Commercial package
          <input list="pricing-package-options" placeholder="Type package code or name…" value={packageSearch} onChange={e => { const value=e.target.value; setPackageSearch(value); const match=packageOptions.find(x=>x.label===value); setPackageId(match?.id || ""); }} required />
          <datalist id="pricing-package-options">{packageOptions.map(pkg => <option key={pkg.id} value={pkg.label} />)}</datalist>
        </label>
        <label>Package price<input name="unitPrice" type="number" step="0.0001" min="0" required /></label>
        <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "package"}>{busy === "package" ? "Saving…" : "Add Package Price"}</button>
        {message && <div className="form-success form-span">{message}</div>}
      </form>
    </CrudModal>
  </>;
}
