"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type TestSuggestion = { id: string; code: string; nameEn: string; score: number };
type UnitSuggestion = { id: string; code: string; symbol: string; score: number };
type DetailItem = { value: string; count: number; suggestion?: TestSuggestion | UnitSuggestion | null; candidates?: Array<TestSuggestion | UnitSuggestion> };
type TestOption = { id: string; code: string; nameEn: string };
type UnitOption = { id: string; code: string; symbol: string };
type Preview = {
  total: number;
  safe: number;
  review: number;
  reasons: Record<string, number>;
  generatedTestsRemaining?: number;
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
  const [mappingSearch, setMappingSearch] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [resolving, setResolving] = useState(false);

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

  async function resolveSafeLegacy() {
    if (!preview) return;
    setResolving(true);
    setMessage("");
    try {
      if ((preview.generatedTestsRemaining || 0) > 0) {
        const masters = await fetch(`/api/catalog/imports/${batchId}/commit`, { method: "POST" });
        const masterBody = await masters.json().catch(() => ({}));
        if (!masters.ok) throw new Error(masterBody.error || "Safe master recovery failed.");
      }

      const ranges = await fetch(`/api/catalog/imports/${batchId}/reference-ranges`, { method: "POST" });
      const rangeBody = await ranges.json().catch(() => ({}));
      if (!ranges.ok) throw new Error(rangeBody.error || "Reference range resolution failed.");

      setMessage(`Resolved ${rangeBody.imported || 0} additional inactive reference intervals; ${rangeBody.review || 0} remain for manual review.`);
      await loadPreview();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Safe legacy resolution failed.");
    } finally {
      setResolving(false);
    }
  }

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

    {((preview.generatedTestsRemaining || 0) > 0 || preview.safe > 0) && <button className="primary-button" disabled={busy || resolving} onClick={resolveSafeLegacy}>{resolving ? "Resolving…" : "Resolve Safe Legacy Items"}</button>}
    {preview.safe > 0 && <button className="secondary-button" disabled={busy || resolving} onClick={run}>{busy ? "Importing ranges…" : "Import Safe Reference Ranges"}</button>}
    {message && <span className="range-import-message">{message}</span>}

    {preview.review > 0 && Object.keys(preview.reasons || {}).length > 0 && <div className="range-review-reasons">
      <strong>Review reasons</strong>
      {Object.entries(preview.reasons).sort((a,b) => b[1]-a[1]).map(([reason,count]) => <div key={reason}><span>{reason}</span><strong>{count}</strong></div>)}
    </div>}

    <datalist id="test-mapping-options">{(preview.testOptions || []).map(test => <option key={test.id} value={`${test.code} — ${test.nameEn}`} />)}</datalist>
    <datalist id="unit-mapping-options">{(preview.unitOptions || []).map(unit => <option key={unit.id} value={`${unit.symbol} (${unit.code})`} />)}</datalist>

    {preview.details && <div className="range-review-details">
      <section>
        <strong>Top unmatched test names</strong>
        {preview.details.unmatchedTests.length === 0 && <p className="muted">None</p>}
        {preview.details.unmatchedTests.map(item => {
          const mapKey = `TEST_ALIAS:${item.value}`;
          return <div className="mapping-row" key={item.value}>
            <div className="mapping-source"><span>{item.value}</span><strong>{item.count}</strong></div>
            {item.suggestion && "nameEn" in item.suggestion && <button className="suggestion-button" type="button" onClick={() => { const s = item.suggestion as TestSuggestion; setMappingTargets(v => ({ ...v, [mapKey]: s.id })); setMappingSearch(v => ({ ...v, [mapKey]: `${s.code} — ${s.nameEn}` })); }}>
              Suggested: {item.suggestion.code} — {item.suggestion.nameEn} ({item.suggestion.score}%)
            </button>}
            {item.candidates && item.candidates.length > 0 && <div className="candidate-list">
              {item.candidates.filter((candidate): candidate is TestSuggestion => "nameEn" in candidate).map(candidate => <button key={candidate.id} type="button" className="candidate-chip" onClick={() => { setMappingTargets(v => ({ ...v, [mapKey]: candidate.id })); setMappingSearch(v => ({ ...v, [mapKey]: `${candidate.code} — ${candidate.nameEn}` })); }}>
                {candidate.code} — {candidate.nameEn} <span>{candidate.score}%</span>
              </button>)}
            </div>}
            <input
              className="mapping-search-input"
              list="test-mapping-options"
              placeholder="Type test name or code…"
              value={mappingSearch[mapKey] || ""}
              onChange={e => {
                const value = e.target.value;
                setMappingSearch(v => ({ ...v, [mapKey]: value }));
                const match = (preview.testOptions || []).find(test => `${test.code} — ${test.nameEn}` === value);
                setMappingTargets(v => ({ ...v, [mapKey]: match?.id || "" }));
              }}
            />
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
            {item.suggestion && "symbol" in item.suggestion && <button className="suggestion-button" type="button" onClick={() => { const s = item.suggestion as UnitSuggestion; setMappingTargets(v => ({ ...v, [mapKey]: s.id })); setMappingSearch(v => ({ ...v, [mapKey]: `${s.symbol} (${s.code})` })); }}>
              Suggested: {item.suggestion.symbol} ({item.suggestion.code}) — {item.suggestion.score}%
            </button>}
            {item.candidates && item.candidates.length > 0 && <div className="candidate-list">
              {item.candidates.filter((candidate): candidate is UnitSuggestion => "symbol" in candidate).map(candidate => <button key={candidate.id} type="button" className="candidate-chip" onClick={() => { setMappingTargets(v => ({ ...v, [mapKey]: candidate.id })); setMappingSearch(v => ({ ...v, [mapKey]: `${candidate.symbol} (${candidate.code})` })); }}>
                {candidate.symbol} ({candidate.code}) <span>{candidate.score}%</span>
              </button>)}
            </div>}
            <input
              className="mapping-search-input"
              list="unit-mapping-options"
              placeholder="Type unit symbol or code…"
              value={mappingSearch[mapKey] || ""}
              onChange={e => {
                const value = e.target.value;
                setMappingSearch(v => ({ ...v, [mapKey]: value }));
                const match = (preview.unitOptions || []).find(unit => `${unit.symbol} (${unit.code})` === value);
                setMappingTargets(v => ({ ...v, [mapKey]: match?.id || "" }));
              }}
            />
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
