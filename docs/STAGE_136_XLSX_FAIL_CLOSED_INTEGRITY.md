# Stage 136 — XLSX table-integrity fail-closed hardening

**Baseline:** owner confirmed Stage 135 deployment `fd52334c9472c93cad261174251c8c7760a4c410`. Independent `main` CI run #38738539269 is SUCCESS. **Master Scope:** §87 controlled configuration import/export; protection of clinical/financial source evidence, §63/79 defense-in-depth.

## Confirmed source gap

The native XLSX review parser in `src/lib/catalog-review-xlsx-import.ts` extracted only rows and cells matching its regular expressions. If a correctly ZIP-checksummed workbook included an unrecognized nonempty cell element (for example `<z r="E2">...</c>` or malformed text markup), the parser could ignore that cell **without rejecting the workbook**, then emit a canonical CSV row with an empty field. Even if downstream validation caught some cases, this was not safe evidence preservation and could distort a source value or silently omit optional fields before human review.

## Safety fix

1. Require exactly one recognized `sheetData` and verify that *every character in its body* is accounted for by accepted `<row>...\</row>` elements. Unexpected rows and self-closing row elements fail closed. Hidden rows expressed as `1` or `true` are rejected.
2. Require that each row's body contains only accepted, completely parsed `<c>...\</c>` cells. Never silently drop unknown or self-closing cell markup. Reject hidden columns.
3. Require a single recognized `<is>...\</is>` string per inline-string cell. Allow basic `<r>` run wrappers and literal `<t>` text but reject unrecognized child elements. Similarly, numeric/shared-string cells may contain at most one accepted `<v>` payload; reject any other hidden children.
4. Preserve bounds, CRCs, ZIP safety, shared strings, literal Unicode text, exact-price decimals, validation grants and preexisting `CSV_REVIEW` DRAFT-only non-committable batch semantics. No schemas, new permissions, medical logic, tariffs or report history touched.

## Regression proof and limits

`tests/stage-136-xlsx-fail-closed-safety.test.ts` uses valid XLSX files and deliberately patches ZIP *worksheet XML*, recalculating the local and central CRCs. It asserts that the reader fails closed for unrecognized cells and text, missing rows and missing `sheetData`, and retains Arabic names and exact four-decimal prices on valid input. This is intentionally a **limited canonical review workbook parser**, not general-purpose XLSX interoperability or unrestricted spreadsheet activation. Rich formatting elements not in the accepted set require user to save a plain canonical review template.

Stage132 real-world UAT remains unexecuted and clinical GO is not authorized by automated CI. §75 interference semantics, §86 tax jurisdiction, §87 full end-to-end mapping/activation and §88 legacy MDB row reconciliation remain open. Do not merge Draft PR #128/#209. Deploy only by owner to Hostinger after feature SHA CI success and independent `main` SHA CI.
