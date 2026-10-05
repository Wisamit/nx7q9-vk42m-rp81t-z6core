"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type TestSuggestion = { id: string; code: string; nameEn: string; score: number };\ntype UnitSuggestion = { id: string; code: string; symbol: string; score: number };\ntype DetailItem = { value: string; count: number; suggestion?: TestSuggestion | UnitSuggestion | null };
type TestOption = { id: string; code: string; nameEn: string };
type UnitOption = { id: string; code: string; symbol: string };
type Preview = {
  total: number;
  safe: number;
  review: number;
  reasons: Record<string, number>;
  details?: {
    unmatchedTests: DetailItem[];
    unmappedUnits: DetailItem[];
    unitConflicts: DetailItem[];
    emptyIntervals: DetailItem[];
  };
  testOptions?: TestOption[];
  unitOptions?: UnitOption[];
};

export function ReferenceRangeImportButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [mappingBusy, setMappingBusy] = useState("");
  const [mappingTargets, setMappingTargets] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  async function loadPreview() {
    const response = await fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    setPreview(data);
    return data as Preview;
  }

  useEffect(() => {
    void loadPreview().catch(() => setPreview(null));
  }, [batchId]);

  async function run() {
    if (!preview?.safe) return;
    if (!confirm(`Import ${preview.safe} reference intervals with exact test/unit/context mapping as INACTIVE records pending clinical approval? ${preview.review} rows will remain for manual review.`)) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`Imported ${body.imported} inactive reference intervals pending clinical approval; ${body.review} remain for mapping review.`);
      await loadPreview();
      router.refresh();
    } else {
      setMessage(body.error || "Reference range import failed.");
    }
    setBusy(false);
  }

  async function saveMapping(mappingType: "TEST_ALIAS" | "UNIT_ALIAS", sourceValue: string) {
    const mapKey = `${mappingType}:${sourceValue}`;
    const targetId = mappingTargets[mapKey];
    if (!targetId) {
      setMessage("Select a target before saving the mapping.");
      return;
    }

    setMappingBusy(mapKey);
    setMessage("");
    const response = await fetch(`/api/catalog/imports/${batchId}/mappings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mappingType, sourceValue, targetId }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      setMessage(`Saved reviewed mapping for "${sourceValue}". Re-analyzed remaining ranges.`);
      await loadPreview();
      router.refresh();
    } else {
      setMessage(body.error || "Could not save mapping.");
    }
    setMappingBusy("");
  }

  if (!preview) return <span className="muted">Analyzing reference ranges…</span>;

  return <div className="range-import-panel">
    <div className="range-import-summary">
      <strong>Reference ranges:</strong>
      <span>{preview.total} staged</span>
      <span>{preview.safe} safe</span>
      <span>{preview.review} review</span>
    </div>

    {preview.safe > 0 && <button className="primary-button" disabled={busy} onClick={run}>{busy ? "Importing ranges…" : "Import Safe Reference Ranges"}</button>}
    {message && <span className="range-import-message">{message}</span>}

    {preview.review > 0 && Object.keys(preview.reasons || {}).length > 0 && <div className="range-review-reasons">
      <strong>Review reasons</strong>
      {Object.entries(preview.reasons).sort((a,b) => b[1]-a[1]).map(([reason,count]) => <div key={reason}><span>{reason}</span><strong>{count}</strong></div>)}
    </div>}

    {preview.details && <div className="range-review-details">
      <section>
        <strong>Top unmatched test names</strong>
        {preview.details.unmatchedTests.length === 0 && <p className="muted">None</p>}
        {preview.details.unmatchedTests.map(item => {
          const mapKey = `TEST_ALIAS:${item.value}`;
          return <div className="mapping-row" key={item.value}>
            <div className="mapping-source"><span>{item.value}</span><strong>{item.count}</strong></div>
            {item.suggestion && "nameEn" in item.suggestion && <button className="suggestion-button" type="button" onClick={() => setMappingTargets(v => ({ ...v, [mapKey]: item.suggestion!.id }))}>
              Suggested: {item.suggestion.code} — {item.suggestion.nameEn} ({item.suggestion.score}%)
            </button>}
            <select value={mappingTargets[mapKey] || ""} onChange={e => setMappingTargets(v => ({ ...v, [mapKey]: e.target.value }))}>
              <option value="">Map to test…</option>
              {(preview.testOptions || []).map(test => <option key={test.id} value={test.id}>{test.code} — {test.nameEn}</option>)}
            </select>
            <button className="secondary-button" disabled={mappingBusy === mapKey} onClick={() => void saveMapping("TEST_ALIAS", item.value)}>{mappingBusy === mapKey ? "Saving…" : "Save"}</button>
          </div>;
        })}
      </section>

      <section>
        <strong>Top unmapped units</strong>
        {preview.details.unmappedUnits.length === 0 && <p className="muted">None</p>}
        {preview.details.unmappedUnits.map(item => {
          const mapKey = `UNIT_ALIAS:${item.value}`;
          return <div className="mapping-row" key={item.value}>
            <div className="mapping-source"><span>{item.value}</span><strong>{item.count}</strong></div>
            {item.suggestion && "symbol" in item.suggestion && <button className="suggestion-button" type="button" onClick={() => setMappingTargets(v => ({ ...v, [mapKey]: item.suggestion!.id }))}>
              Suggested: {item.suggestion.symbol} ({item.suggestion.code}) — {item.suggestion.score}%
            </button>}
            <select value={mappingTargets[mapKey] || ""} onChange={e => setMappingTargets(v => ({ ...v, [mapKey]: e.target.value }))}>
              <option value="">Map to unit…</option>
              {(preview.unitOptions || []).map(unit => <option key={unit.id} value={unit.id}>{unit.symbol} ({unit.code})</option>)}
            </select>
            <button className="secondary-button" disabled={mappingBusy === mapKey} onClick={() => void saveMapping("UNIT_ALIAS", item.value)}>{mappingBusy === mapKey ? "Saving…" : "Save"}</button>
          </div>;
        })}
      </section>

      <section>
        <strong>Top unit conflicts</strong>
        <p className="muted">These stay manual-review only because the legacy range unit conflicts with the mapped test unit.</p>
        {preview.details.unitConflicts.map(item => <div key={item.value}><span>{item.value}</span><strong>{item.count}</strong></div>)}
      </section>
    </div>}
  </div>;
}
