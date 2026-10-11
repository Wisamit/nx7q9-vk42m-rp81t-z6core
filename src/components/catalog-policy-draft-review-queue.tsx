"use client";

import { useState } from "react";
import { policyKeys, type CatalogPolicyProposal, type CatalogPolicyKey } from "@/lib/catalog-policy-options";

type Domain = "CLINICAL" | "FINANCIAL";
type Disposition = "NOTED_FOR_DISCUSSION" | "RETURN_FOR_REVISION";
type Entry = { batchId: string; draftEventId: string; revision: number;
  recordedAt: string; domains: Domain[] };
type Detail = { status: string; domain: Domain; draftEventId: string; revision: number;
  proposal: CatalogPolicyProposal; proposalDigest: string; reviewOnly: boolean;
  approved: boolean; signingEnabled: boolean; activated: boolean; liveWrites: boolean };
type Reason = { code: string; en: string; ar: string };
const reasonByDomain: Record<Domain, Reason[]> = {
  CLINICAL: [
    { code: "CLINICAL_AUTHORITY_UNCLEAR", en: "Clinical authority is unclear",
      ar: "المسؤولية الطبية غير واضحة" },
    { code: "CLINICAL_SAFETY_REVIEW_UNDEFINED", en: "Clinical safety review is undefined",
      ar: "مراجعة السلامة السريرية غير محددة" },
    { code: "BRANCH_SCOPE_UNCLEAR", en: "Branch authority is unclear", ar: "صلاحيات الفروع غير واضحة" },
    { code: "MAKER_CHECKER_INDEPENDENCE_UNCLEAR", en: "Independent reviewers are not defined",
      ar: "فصل المراجعين المستقلين غير واضح" },
    { code: "REAUTHENTICATION_UNDEFINED", en: "Signer authentication is undefined",
      ar: "مصادقة الموقّع غير محددة" },
    { code: "VERSIONED_RELEASE_UNDEFINED", en: "Versioned activation is undefined",
      ar: "آلية التفعيل مع حفظ الإصدارات غير محددة" },
  ],
  FINANCIAL: [
    { code: "FINANCIAL_AUTHORITY_UNCLEAR", en: "Financial authority is unclear",
      ar: "المسؤولية المالية غير واضحة" },
    { code: "BRANCH_SCOPE_UNCLEAR", en: "Branch authority is unclear", ar: "صلاحيات الفروع غير واضحة" },
    { code: "MAKER_CHECKER_INDEPENDENCE_UNCLEAR", en: "Independent reviewers are not defined",
      ar: "فصل المراجعين المستقلين غير واضح" },
    { code: "REAUTHENTICATION_UNDEFINED", en: "Signer authentication is undefined",
      ar: "مصادقة الموقّع غير محددة" },
    { code: "VERSIONED_RELEASE_UNDEFINED", en: "Versioned activation is undefined",
      ar: "آلية التفعيل مع حفظ الإصدارات غير محددة" },
  ],
};
const labels: Record<CatalogPolicyKey, [string, string]> = {
  clinicalAuthority: ["Clinical responsibility", "المسؤولية الطبية"],
  financialAuthority: ["Financial responsibility", "المسؤولية المالية"],
  branchDelegation: ["Branch delegation", "تفويض الفروع"],
  reviewerSeparation: ["Independent reviewers", "المراجعون المستقلون"],
  signerAuthentication: ["Signer authentication proposal", "مقترح مصادقة الموقّع"],
  versionedApplication: ["Versioned application proposal", "مقترح التطبيق وحفظ الإصدارات"],
  clinicalSafetyCheck: ["Clinical safety review", "مراجعة السلامة السريرية"],
};
export function CatalogPolicyDraftReviewQueue({ locale }: { locale: "ar" | "en" }) {
  const tr = (en: string, ar: string) => locale === "ar" ? ar : en;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState<{ entry: Entry; domain: Domain; detail: Detail } | null>(null);
  const [disposition, setDisposition] = useState<Disposition>("RETURN_FOR_REVISION");
  const [reason, setReason] = useState("CLINICAL_AUTHORITY_UNCLEAR");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function refresh() {
    if (busy) return;
    setBusy(true); setError(""); setNotice(""); setSelected(null);
    try {
      const response = await fetch("/api/catalog/imports/policy-review-queue", {
        credentials: "same-origin", cache: "no-store",
      });
      const result = await response.json() as {
        entries?: Entry[]; error?: string; approval?: boolean; signingEnabled?: boolean;
        activation?: boolean; liveWrites?: boolean;
      };
      if (!response.ok || result.approval !== false || result.signingEnabled !== false ||
          result.activation !== false || result.liveWrites !== false ||
          !Array.isArray(result.entries) || result.entries.length > 30)
        throw new Error(result.error || "policy_review_queue_unavailable");
      setEntries(result.entries);
      setLoaded(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "policy_review_queue_unavailable");
    } finally { setBusy(false); }
  }
  async function inspect(entry: Entry, domain: Domain) {
    if (busy) return;
    setBusy(true); setError(""); setNotice(""); setSelected(null);
    try {
      const url = "/api/catalog/imports/" + encodeURIComponent(entry.batchId) +
        "/policy-review?draftEventId=" + encodeURIComponent(entry.draftEventId) +
        "&domain=" + encodeURIComponent(domain);
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      const result = await response.json() as Detail & { error?: string };
      if (!response.ok || result.status !== "POLICY_DRAFT_REVIEW_READY" ||
          result.domain !== domain || result.draftEventId !== entry.draftEventId ||
          result.revision !== entry.revision || result.reviewOnly !== true ||
          result.approved !== false || result.signingEnabled !== false ||
          result.activated !== false || result.liveWrites !== false ||
          !result.proposal || policyKeys.some(key => typeof result.proposal[key] !== "string"))
        throw new Error(result.error || "policy_review_not_ready");
      setDisposition("RETURN_FOR_REVISION");
      setReason(reasonByDomain[domain][0].code);
      setSelected({ entry, domain, detail: result });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "policy_review_not_ready");
    } finally { setBusy(false); }
  }
  async function record() {
    if (!selected || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const body = {
        draftEventId: selected.entry.draftEventId, domain: selected.domain,
        disposition, reasonCode: disposition === "NOTED_FOR_DISCUSSION"
          ? "NO_FURTHER_OBJECTION_TO_DISCUSSION" : reason,
      };
      const response = await fetch("/api/catalog/imports/" +
        encodeURIComponent(selected.entry.batchId) + "/policy-review", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const result = await response.json() as {
        error?: string; status?: string; approved?: boolean;
        signingEnabled?: boolean; activated?: boolean; liveWrites?: boolean;
      };
      if (!response.ok ||
          !["POLICY_DRAFT_REVIEW_RECORDED", "ALREADY_RECORDED"].includes(result.status || "") ||
          result.approved !== false || result.signingEnabled !== false ||
          result.activated !== false || result.liveWrites !== false)
        throw new Error(result.error || "policy_review_record_rejected");
      setSelected(null);
      setNotice(tr(
        "Procedural draft comment recorded in Audit. No signature, approval or activation.",
        "سُجلت ملاحظة المراجعة التنظيمية في Audit دون توقيع أو اعتماد أو تفعيل.",
      ));
      setEntries(previous => previous.map(entry =>
        entry.draftEventId === selected.entry.draftEventId
          ? { ...entry, domains: entry.domains.filter(domain => domain !== selected.domain) }
          : entry,
      ).filter(entry => entry.domains.length > 0));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "policy_review_record_rejected");
    } finally { setBusy(false); }
  }
  return <section className="table-card no-print">
    <div className="table-toolbar">
      <div>
        <h2>{tr("Independent policy-draft review — NOT SIGNING",
          "مراجعة مستقلة لمسودات السياسة — ليست توقيعاً")}</h2>
        <p className="muted">{tr(
          "A clinical reviewer and a different financial reviewer may log procedural comments on the latest unsigned proposal. They must not be the source author. These comments never authorize activation.",
          "يمكن لمراجع طبي ومراجع مالي مختلف عنه تسجيل ملاحظات تنظيمية على أحدث مسودة غير موقّعة، ويجب أن يختلفا عن صاحب المسودة. لا تجيز الملاحظات أي تفعيل.",
        )}</p>
      </div>
      <button type="button" className="secondary-button" disabled={busy}
        onClick={() => void refresh()}>{busy ? tr("Checking…", "جارٍ الفحص…")
          : tr("Refresh policy drafts", "تحديث مسودات السياسة")}</button>
    </div>
    {error && <p role="alert">{tr("Review unavailable: ", "تعذرت المراجعة: ")}{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {loaded && (entries.length === 0
      ? <p className="muted">{tr("No eligible current policy drafts in this branch.",
        "لا توجد مسودات سياسة حالية قابلة للمراجعة ضمن هذا الفرع.")}</p>
      : <div className="table-wrap"><table>
        <thead><tr><th>{tr("Revision", "النسخة")}</th>
          <th>{tr("Domain review", "المراجعة المتخصصة")}</th></tr></thead>
        <tbody>{entries.map(entry => <tr key={entry.draftEventId}>
          <td>{entry.revision}</td><td>{entry.domains.map(domain =>
            <button type="button" className="secondary-button" disabled={busy}
              key={domain} onClick={() => void inspect(entry, domain)}>
              {domain === "CLINICAL" ? tr("Inspect clinical policy", "فحص السياسة الطبية")
                : tr("Inspect financial policy", "فحص السياسة المالية")}
            </button>)}</td>
        </tr>)}</tbody>
      </table></div>)}
    {selected && <div className="table-card">
      <h3>{tr("Draft proposal review — no signatory authority", "مراجعة المسودة — دون صلاحية توقيع")}</h3>
      <p>{tr("Revision", "النسخة")}: {selected.detail.revision} · {
        selected.domain === "CLINICAL" ? tr("Clinical", "طبي") : tr("Financial", "مالي")}</p>
      <div className="table-wrap"><table>
        <thead><tr><th>{tr("Policy topic", "موضوع السياسة")}</th>
          <th>{tr("Proposed value (not approved)", "القيمة المقترحة (غير معتمدة)")}</th></tr></thead>
        <tbody>{policyKeys.map(key => <tr key={key}>
          <td>{tr(...labels[key])}</td><td>{selected.detail.proposal[key]}</td>
        </tr>)}</tbody>
      </table></div>
      <label>{tr("Procedural review outcome", "نتيجة المراجعة التنظيمية")}
        <select value={disposition} disabled={busy}
          onChange={event => setDisposition(event.target.value as Disposition)}>
          <option value="RETURN_FOR_REVISION">{tr("Return proposal for revision", "إعادة المقترح للتعديل")}</option>
          <option value="NOTED_FOR_DISCUSSION">{tr("Noted for discussion (NOT approval)", "تدوين للمناقشة (ليس اعتماداً)")}</option>
        </select>
      </label>
      {disposition === "RETURN_FOR_REVISION" && <label>{
        tr("Structured objection", "سبب الاعتراض") }
        <select value={reason} disabled={busy} onChange={event => setReason(event.target.value)}>
          {reasonByDomain[selected.domain].map(item => <option key={item.code}
            value={item.code}>{tr(item.en, item.ar)}</option>)}
        </select>
      </label>}
      <p className="muted">{tr(
        "Saving a comment preserves the signed-off=false draft history. Actual approval and application remain disabled.",
        "حفظ الملاحظة يُبقي المسودة غير معتمدة ويحفظ تاريخها. الاعتماد والتطبيق الفعلي معطّلان.",
      )}</p>
      <button type="button" className="secondary-button" disabled={busy}
        onClick={() => void record()}>{tr("Record nonbinding review in Audit",
          "تسجيل مراجعة غير ملزمة في Audit")}</button>
    </div>}
  </section>;
}
