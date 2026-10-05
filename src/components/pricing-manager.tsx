"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Option = { id: string; code: string; nameEn: string };
type ContractOption = Option & { clientId: string };
type TestOption = { id: string; code: string; nameEn: string };
type PriceListOption = { id: string; code: string; nameEn: string; currency: string };

export function PricingManager({
  branches,
  clients,
  contracts,
  tests,
  priceLists,
  defaultCurrency,
}: {
  branches: Option[];
  clients: Option[];
  contracts: ContractOption[];
  tests: TestOption[];
  priceLists: PriceListOption[];
  defaultCurrency: string;
}) {
  const router = useRouter();
  const [scopeType, setScopeType] = useState("ORGANIZATION");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"contract" | "list" | "item" | "">("");
  const [testSearch, setTestSearch] = useState("");
  const [testId, setTestId] = useState("");

  const testOptions = useMemo(() => tests.map((test) => ({
    ...test,
    label: `${test.code} — ${test.nameEn}`,
  })), [tests]);

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
    } else setMessage(body.error || "Could not add test price.");
    setBusy("");
  }

  return <div className="detail-grid">
    <article className="detail-card">
      <h2>Create Client Contract</h2>
      <form className="catalog-form" onSubmit={createContract}>
        <label>Code<input name="code" placeholder="Optional; generated from name" /></label>
        <label>Client<select name="clientId" required><option value="">Select client…</option>{clients.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn}</option>)}</select></label>
        <label>Name (English)<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <label>Currency<input name="currency" required maxLength={3} defaultValue={defaultCurrency} /></label>
        <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "contract"}>{busy === "contract" ? "Saving…" : "Create Contract"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Create Price List</h2>
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
      </form>
    </article>

    <article className="detail-card">
      <h2>Add Test Price</h2>
      <form className="catalog-form" onSubmit={addPrice}>
        <label className="form-span">Price list<select name="priceListId" required><option value="">Select price list…</option>{priceLists.map(x => <option key={x.id} value={x.id}>{x.code} — {x.nameEn} ({x.currency})</option>)}</select></label>
        <label className="form-span">Test
          <input
            list="pricing-test-options"
            placeholder="Type test code or name…"
            value={testSearch}
            onChange={e => {
              const value = e.target.value;
              setTestSearch(value);
              const match = testOptions.find(x => x.label === value);
              setTestId(match?.id || "");
            }}
            required
          />
          <datalist id="pricing-test-options">{testOptions.map(test => <option key={test.id} value={test.label} />)}</datalist>
        </label>
        <label>Unit price<input name="unitPrice" type="number" step="0.0001" min="0" required /></label>
        <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={new Date().toISOString().slice(0,10)} /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "item"}>{busy === "item" ? "Saving…" : "Add Test Price"}</button>
      </form>
      {message && <p className="form-success">{message}</p>}
    </article>
  </div>;
}
