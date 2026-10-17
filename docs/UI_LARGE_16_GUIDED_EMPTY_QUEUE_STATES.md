# Large UI release batch — 16 clinical / administrative list pages and 39 guided empty states

## Baseline and purpose

- Owner-confirmed Hostinger deployment of `main 8d771cb7d6230f431fc84772dd8af56713d911eb` (PR #286, feature CI #1674 success, merged-main CI #1675 success).
- The prior 81-route source audit **was not a browser visual test**; actual owner screenshots already revealed real missing UI details. This package delivers another deliberately **large cohesive correction** rather than individual hotfixes.
- On the screens below, an empty table often rendered a single tiny sentence across 6–13 table columns. Operators could not easily distinguish lack of matches, unconfigured master data, absent external messages, or workflows that must be completed elsewhere.
- A new non-mutating reusable server-compatible presentation component, `TableEmptyState`, renders a localized title, scoped explanation, accessible status and optional **same authorized route** reset link inside the original `<td colSpan>`. No user data is fetched or mutated in this component.

## Sixteen canonical pages / thirty-nine contextual no-data rows

| Group | Pages | Empty contexts |
|---|---|---|
| Clinical intake and orders | `/patients`, `/orders`, `/worklists`, `/reports`, `/microbiology` | 5 |
| Billing | `/billing`, `/billing/reports`, `/billing/accounts/aging` | 10 |
| Devices and quality | `/analyzers`, `/equipment`, `/qc` | 8 |
| Materials and supply chain | `/inventory` | 3 |
| Master data and integration | `/catalog`, `/referrers`, `/integrations` | 11 |
| Communications | `/notifications` | 2 |
| **Total** | **16 canonical route pages** | **39 distinct table empty states** |

Each empty state is authored in both Arabic and English and explains what its queue normally contains, what the selected access/filter context means, or which authorized workflow creates real records. Where it is safe and relevant, `patients`, `reports`, `worklists`, `billing/reports`, and `billing/accounts/aging` show an ordinary reset link to their **existing server-authorized page**.

## Clinical, financial, tenancy and audit guardrails

- No patient record, invoice, specimen, laboratory result, comment, message, analyzer observation or financial transaction has been created or modified, and there are no schema migrations.
- Original zero-result query predicates, `<td colSpan>`, pagination and table headers remain unchanged. This is solely the **rendered explanation** of an empty authorized result set, not an assertion that the entire organization has no results.
- Physician/patient identity, financial currency separation and historical aging reconstruction remain unchanged. Critical result acknowledgments, analyzer interface evidence, and QC release-block policy are untouched.
- No shortcut is created to bypass role/branch-scoped server permissions. Optional reset links use only existing page routes and are shown only inside the same authorized page after authentication.
- Accessibility: meaningful structured status inside each empty cell, readable multi-line text, visible focus ring for reset link, small-screen responsive spacing, neutral palette using system settings and dark-mode theme tokens. Arabic/English text aligns naturally with inherited RTL/LTR.
- No generated demo or placeholder medical data is inserted just to make a table appear filled.

## Automated verification and unresolved acceptance

- `tests/ui-large-sixteen-guided-empty-states.test.ts` asserts 16 unique canonical pages, exactly 39 states, explicit bilingual text on each, unchanged view permissions and selected clinical/financial safety semantics, valid reset links and responsive theme CSS. Existing TypeScript, ESLint, safety, MariaDB integration tests and production Next.js build must pass on **exact feature HEAD**, then **exact merged main SHA**.
- **Real browser visual testing, full 81-route 486 screenshot target, AR/EN RTL/LTR, light/dark, viewport/keyboard use, and true clinical/finance/device/disaster recovery signoff have NOT been performed by this batch.**
- Issue #265 stays OPEN pending real visual acceptance. Issue #250 stays OPEN / clinical-financial GO/NO_GO not approved. Hostinger deployment of the eventual merge requires owner confirmation.
