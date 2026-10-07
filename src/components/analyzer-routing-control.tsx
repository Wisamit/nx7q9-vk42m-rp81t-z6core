"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AnalyzerOption = {
  id: string;
  code: string;
  name: string;
};

type AssignedRoute = {
  analyzerId: string;
  analyzerCodeSnapshot: string;
  analyzerNameSnapshot: string;
};

export function AnalyzerRoutingControl({
  orderItemId,
  assigned,
  candidates,
  canRoute,
  locale,
}: {
  orderItemId: string;
  assigned: AssignedRoute[];
  candidates: AnalyzerOption[];
  canRoute: boolean;
  locale: "ar" | "en";
}) {
  const router = useRouter();
  const tr = <T,>(en: T, ar: T) => locale === "ar" ? ar : en;
  const [selectedAnalyzerId, setSelectedAnalyzerId] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const assignedIds = new Set(assigned.map(item => item.analyzerId));
  const availableCandidates = candidates.filter(item => !assignedIds.has(item.id));

  async function assign() {
    if (!selectedAnalyzerId) return;
    setBusy("assign");
    setMessage("");

    const response = await fetch("/api/worklists/" + orderItemId + "/analyzers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analyzerId: selectedAnalyzerId }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setBusy("");

    if (!response.ok) {
      setMessage(body.error || tr("Could not assign analyzer.", "تعذر تعيين جهاز التحليل."));
      return;
    }

    setSelectedAnalyzerId("");
    router.refresh();
  }

  async function clear(analyzerId: string, analyzerLabel: string) {
    const reason = window.prompt(tr(
      "Reason for removing " + analyzerLabel + " from this work item:",
      "سبب إزالة " + analyzerLabel + " من عنصر العمل:",
    ));
    if (!reason?.trim()) return;

    setBusy(analyzerId);
    setMessage("");
    const response = await fetch("/api/worklists/" + orderItemId + "/analyzers", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analyzerId, reason }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    setBusy("");

    if (!response.ok) {
      setMessage(body.error || tr("Could not remove analyzer routing.", "تعذر إزالة توجيه جهاز التحليل."));
      return;
    }

    router.refresh();
  }

  return <div className="summary-list">
    {assigned.length === 0
      ? <span className="muted">{tr("Unassigned", "غير معيّن")}</span>
      : assigned.map(item => <div key={item.analyzerId}>
          <span>{item.analyzerCodeSnapshot}</span>
          <strong>{item.analyzerNameSnapshot}</strong>
          {canRoute && <button
            type="button"
            className="secondary-button"
            disabled={busy !== ""}
            onClick={() => void clear(item.analyzerId, item.analyzerCodeSnapshot + " — " + item.analyzerNameSnapshot)}
          >{busy === item.analyzerId ? tr("Removing…", "جارٍ الإزالة…") : tr("Remove", "إزالة")}</button>}
        </div>)}

    {canRoute && availableCandidates.length > 0 && <div>
      <select
        value={selectedAnalyzerId}
        onChange={event => setSelectedAnalyzerId(event.target.value)}
        aria-label={tr("Assign analyzer", "تعيين جهاز تحليل")}
      >
        <option value="">{tr("Assign analyzer…", "تعيين جهاز تحليل…")}</option>
        {availableCandidates.map(item => <option key={item.id} value={item.id}>{item.code} — {item.name}</option>)}
      </select>
      <button
        type="button"
        className="secondary-button"
        disabled={busy !== "" || !selectedAnalyzerId}
        onClick={() => void assign()}
      >{busy === "assign" ? tr("Assigning…", "جارٍ التعيين…") : tr("Assign", "تعيين")}</button>
    </div>}

    {canRoute && assigned.length === 0 && availableCandidates.length === 0 &&
      <small className="muted">{tr("No mapped analyzer is available at the specimen branch.", "لا يوجد جهاز تحليل مربوط ومتاح في فرع العينة.")}</small>}

    {message && <small className="form-error">{message}</small>}
  </div>;
}
