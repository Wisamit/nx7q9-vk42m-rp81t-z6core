"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Branch = { id: string; code: string; nameEn: string };
type Method = { id: string; code: string; nameEn: string };
type ComponentOption = { id: string; code: string; nameEn: string };
type TestOption = { id: string; code: string; nameEn: string; methodId: string | null; components: ComponentOption[] };

export function ClinicalRulesManager({
  tests,
  branches,
  methods,
}: {
  tests: TestOption[];
  branches: Branch[];
  methods: Method[];
}) {
  const router = useRouter();
  const [deltaTestId, setDeltaTestId] = useState("");
  const [commentTestId, setCommentTestId] = useState("");
  const [commentScope, setCommentScope] = useState("ORGANIZATION");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const deltaComponents = useMemo(
    () => tests.find((test) => test.id === deltaTestId)?.components || [],
    [tests, deltaTestId],
  );
  const commentComponents = useMemo(
    () => tests.find((test) => test.id === commentTestId)?.components || [],
    [tests, commentTestId],
  );

  async function createDelta(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("delta"); setMessage("");
    const response = await fetch("/api/clinical-rules/delta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        testId: form.get("testId"),
        componentId: form.get("componentId"),
        branchId: form.get("branchId"),
        methodId: form.get("methodId"),
        absoluteLimit: form.get("absoluteLimit"),
        percentLimit: form.get("percentLimit"),
        lookbackDays: form.get("lookbackDays"),
        effectiveFrom: form.get("effectiveFrom"),
        effectiveTo: form.get("effectiveTo"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage("Delta rule created.");
      event.currentTarget.reset();
      setDeltaTestId("");
      router.refresh();
    } else setMessage(body.error || "Could not create delta rule.");
    setBusy("");
  }

  async function createComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy("comment"); setMessage("");
    const response = await fetch("/api/clinical-rules/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope: commentScope,
        testId: form.get("testId"),
        componentId: form.get("componentId"),
        code: form.get("code"),
        nameEn: form.get("nameEn"),
        nameAr: form.get("nameAr"),
        textEn: form.get("textEn"),
        textAr: form.get("textAr"),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage("Comment template created.");
      event.currentTarget.reset();
      setCommentScope("ORGANIZATION");
      setCommentTestId("");
      router.refresh();
    } else setMessage(body.error || "Could not create comment template.");
    setBusy("");
  }

  return <div className="detail-grid">
    <article className="detail-card">
      <h2>Create Delta Rule</h2>
      <p className="muted">Compare a new numeric result against the patient&apos;s prior released value. Exceeding either configured threshold is flagged for review.</p>
      <form className="catalog-form" onSubmit={createDelta}>
        <label>Test<select name="testId" required value={deltaTestId} onChange={(e) => setDeltaTestId(e.target.value)}>
          <option value="">Select test…</option>
          {tests.map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}
        </select></label>
        <label>Component<select name="componentId" defaultValue="" disabled={!deltaTestId}>
          <option value="">Whole/simple test</option>
          {deltaComponents.map(component => <option key={component.id} value={component.id}>{component.code} — {component.nameEn}</option>)}
        </select></label>
        <label>Branch<select name="branchId" defaultValue=""><option value="">All branches</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.code} — {branch.nameEn}</option>)}</select></label>
        <label>Method<select name="methodId" defaultValue=""><option value="">All methods</option>{methods.map(method => <option key={method.id} value={method.id}>{method.code} — {method.nameEn}</option>)}</select></label>
        <label>Absolute limit<input name="absoluteLimit" type="number" min="0" step="0.00000001" /></label>
        <label>Percent limit<input name="percentLimit" type="number" min="0" step="0.000001" /></label>
        <label>Lookback days<input name="lookbackDays" type="number" min="1" max="3650" defaultValue="365" required /></label>
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={new Date().toISOString().slice(0,10)} required /></label>
        <label>Effective to<input name="effectiveTo" type="date" /></label>
        <button className="primary-button form-span" disabled={busy === "delta"}>{busy === "delta" ? "Saving…" : "Create Delta Rule"}</button>
      </form>
    </article>

    <article className="detail-card">
      <h2>Create Result Comment Template</h2>
      <form className="catalog-form" onSubmit={createComment}>
        <label>Scope<select value={commentScope} onChange={(e) => setCommentScope(e.target.value)}><option>ORGANIZATION</option><option>TEST</option><option>COMPONENT</option></select></label>
        <label>Code<input name="code" placeholder="Optional; generated from name" /></label>
        {commentScope !== "ORGANIZATION" && <label>Test<select name="testId" required value={commentTestId} onChange={(e) => setCommentTestId(e.target.value)}>
          <option value="">Select test…</option>{tests.map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}
        </select></label>}
        {commentScope === "COMPONENT" && <label>Component<select name="componentId" required defaultValue=""><option value="">Select component…</option>{commentComponents.map(component => <option key={component.id} value={component.id}>{component.code} — {component.nameEn}</option>)}</select></label>}
        <label>Name (English)<input name="nameEn" required /></label>
        <label dir="rtl">الاسم بالعربية<input name="nameAr" dir="rtl" /></label>
        <label className="form-span">Comment (English)<textarea name="textEn" rows={3} required /></label>
        <label className="form-span" dir="rtl">التعليق بالعربية<textarea name="textAr" rows={3} dir="rtl" /></label>
        <button className="primary-button form-span" disabled={busy === "comment"}>{busy === "comment" ? "Saving…" : "Create Comment Template"}</button>
      </form>
    </article>
    {message && <div className="form-success form-span">{message}</div>}
  </div>;
}
