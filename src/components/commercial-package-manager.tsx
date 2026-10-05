"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type TestOption = { id: string; code: string; nameEn: string };

export function CommercialPackageManager({ tests }: { tests: TestOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const options = useMemo(() => tests.map(test => ({
    ...test,
    label: `${test.code} — ${test.nameEn}`,
  })), [tests]);
  const selected = selectedIds.map(id => tests.find(test => test.id === id)).filter((x): x is TestOption => Boolean(x));

  function addTest() {
    const match = options.find(option => option.label === search);
    if (!match) {
      setMessage("Select a valid test from the suggestions.");
      return;
    }
    setSelectedIds(ids => ids.includes(match.id) ? ids : [...ids, match.id]);
    setSearch("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selectedIds.length === 0) {
      setMessage("Add at least one test to the package.");
      return;
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/catalog/packages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        descriptionEn: form.get("descriptionEn"),
        descriptionAr: form.get("descriptionAr"),
        testIds: selectedIds,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`Package created: ${body.package.code}`);
      setSelectedIds([]);
      setSearch("");
      event.currentTarget.reset();
      router.refresh();
    } else {
      setMessage(body.error || "Could not create package.");
    }
    setBusy(false);
  }

  return <>
    <button className="secondary-button" type="button" onClick={() => setOpen(true)}>Commercial Package</button>
    {open && <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setOpen(false)}>
      <div className="modal-card">
        <div className="modal-head">
          <div><p className="eyebrow">Commercial Catalog</p><h2>Create Package</h2></div>
          <button className="icon-button" type="button" onClick={() => setOpen(false)}>×</button>
        </div>
        <p className="muted">Packages are commercial groupings. Member tests remain separate clinical order items for specimen, result and audit traceability.</p>
        <form className="catalog-form" onSubmit={submit}>
          <label>Code<input name="code" required maxLength={80} /></label>
          <label>Name (English)<input name="nameEn" required maxLength={220} /></label>
          <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" maxLength={220} /></label>
          <label className="form-span">Description<textarea name="descriptionEn" rows={2} /></label>
          <label className="form-span" dir="rtl">الوصف<textarea name="descriptionAr" rows={2} dir="rtl" /></label>
          <div className="form-span order-test-picker">
            <label>Member tests
              <div className="inline-search">
                <input list="commercial-package-test-options" value={search} onChange={event => setSearch(event.target.value)} placeholder="Type test code or name…" />
                <button type="button" className="secondary-button" onClick={addTest}>Add Test</button>
              </div>
              <datalist id="commercial-package-test-options">{options.map(option => <option key={option.id} value={option.label} />)}</datalist>
            </label>
            <div className="selected-test-list">
              {selected.length === 0 ? <span className="muted">No tests selected.</span> : selected.map(test =>
                <span className="selected-test-chip" key={test.id}>{test.code} — {test.nameEn}<button type="button" onClick={() => setSelectedIds(ids => ids.filter(id => id !== test.id))}>×</button></span>
              )}
            </div>
          </div>
          {message && <div className="form-success form-span">{message}</div>}
          <button className="primary-button form-span" disabled={busy}>{busy ? "Saving…" : "Create Commercial Package"}</button>
        </form>
      </div>
    </div>}
  </>;
}
