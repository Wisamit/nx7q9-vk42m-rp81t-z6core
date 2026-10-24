# F8 §88 — Ordered legacy profile membership semantic parity

**Base:** main `6804ec26159eb39368a364fa9ad68ab245eedca4` after PR #385 (independent main push CI #40063372158 COMPLETED SUCCESS). The full original 88-section Master Scope remains unchanged.

## Source-proven discrepancy

`src/lib/f3-legacy-semantic-parity.ts` uses typed `MEMBER_CODES` to compare a migrated Access profile/panel/package membership list. It previously uppercased and **sorted** both source and target lists before comparison. A legacy profile `[CBC, GLU]` and a new profile `[GLU, CBC]` produced the same reported semantic parity even where source order controls the display order, printing, or workflows. This hid a source-to-target discrepancy, while Stage 143/144 source-file authentication alone does not check clinical report ordering.

## Implemented software boundary

- `MEMBER_CODES` is now **order-sensitive** by default. It retains documented case-insensitive code equivalence and forbids duplicate items, malformed codes, and changed members; changed order produces an aggregate `SYNTHETIC_SEMANTIC_VALUE_GAPS` result, never raw codes, digests or PHI in the report.
- Only an explicit, trusted private semantic policy may choose new `UNORDERED_MEMBER_CODES` for a membership comparison whose order a qualified source reviewer has independently determined not to be operationally meaningful. The default will not silently infer this.
- Existing synthetic parity fixture now preserves ordered membership, and regression tests cover reversal detection, unchanged case normalization, missing/extra members, explicit opt-in, opt-in duplicate rejection, invalid policy kind, no clinical GO/cutover flags.
- Comparison remains **private/offline, synthetic, review-only**: no master import, activation, patient record updates, financial mutation or public legacy MDB/PHI disclosures. Comparison kind selected by trusted local policy is not an expert signoff.

## Remaining acceptance and strict NO_GO

§88 still needs authorized Microsoft ACE/Windows extraction from the original private MDB, source-row HMAC lineage, complete 15-table mapping, one-to-one target evidence and independent qualified clinical/finance approval. This PR cannot prove any of those external facts.

§75 real analyzer/HIL vendor policies, §86 jurisdiction-specific tax/currency policies, and §87 complete field-governed activation remain open where qualified signed evidence is absent. F7 0/486 private browser checks and F8 0/88 qualified real-world cases; seven independent signatures absent. `NO_GO`. No Hostinger deployment/device or DR evidence claimed.

**Merge gates:** complete CI SUCCESS on exact feature HEAD, PR/branch SHA match, expected-head merge, independent main push CI COMPLETE SUCCESS on exact new main merge SHA.
