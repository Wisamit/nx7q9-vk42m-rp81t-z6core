# Screenshot-driven UI correction — four operational screens

## Evidence and scope

User-submitted screenshots on 2026-10-17 identified genuine visual inconsistency despite earlier **81/81 canonical source-path inventory**. That inventory never demonstrated real-browser visual acceptance. This correction intentionally reopens visual QA work under issue #265 rather than assuming route counting guarantees a release-quality interface.

Screens discussed:

1. **Home Collections** — `/home-collections`: heading and filters start flush against the sidebar because `.page-shell` lacked base padding. Bare selects and empty table are visually unclear.
2. **Critical Results** — `/critical-results`: large empty nine-column table and inline mixed active-filter controls; information below the table lacks structured footer spacing.
3. **Comment Approvals** — `/clinical-comments/review`: header starts flush against sidebar, count card occupies only the left half of a two-column grid, empty worklist consumes visual room without guidance.
4. **Comment Revisions** — `/clinical-comments/revisions`: same missing gutter and a full card with no actionable content when no approved source revision exists.

## Implemented corrective measures

- **Root cause:** Add the existing `.catalog-shell` desktop/mobile gutters to `.page-shell` itself, while retaining `min-width:0` within the responsive system grid. Other `.page-shell` consumers benefit from the consistent base layout.
- **Scoped components:** Shared `.workflow-page` CSS rules for operational filtering, selected tabs, empty states, audit/worklist cards, responsive tables and pagination, using existing organization/theme CSS tokens; Arabic RTL responsive behavior retained.
- Home Collections uses labeled branch/status controls, a visible clear-filter action only when filtered, and a clear scoped no-data explanation. Existing organization/branch/collector checks, order links and 100-item pagination stay server-side.
- Critical Results shows visibly selected filters via `aria-current`; no-results panel distinguishes no overdue events from no open events, while preserving critical-value snapshots, due dates, page cursor, snapshot counts and independent clinical escalation rules. Existing event timestamps render using the performing branch timezone.
- Comment Approvals uses a full-width compact summary and a worklist with an actual no-data state. The governed approval button and independent-review blockers stay unchanged; no simulated medical data.
- Comment Revisions displays a contextual no-approved-source empty state instead of a dead-end editor card. The approval queue link is shown only to a user already granted `clinical_rules.approve`; version creation still requires an existing approved template and review fingerprint.
- New `tests/ui-four-screenshot-feedback-qa.test.ts` asserts the layout contracts and clinical/authorization invariants.

## Acceptance constraints

- No Prisma migration, billing/financial mutation, patient release, report amendment, reference range approval, analyzer override, critical result acknowledgement or specimen custody changes.
- No fake patient, pending template or critical event is inserted simply to fill empty screens: zero counts in the screenshots can be valid data.
- **The user screenshots were reviewed as evidence**, but an authenticated staging-browser regression pass was **not executable here**; keyboard/mobile/Arabic/English/light/dark screenshots and interactions must still be validated on deployed code with appropriately authorized synthetic fixtures.
- Source contract tests and GitHub CI do not equal browser acceptance. Issue #265 stays OPEN; final clinical/financial issue #250 stays OPEN/NO_GO.
