# Stage 126 — Catalog, composite configuration and legacy source closeout

**Start SHA:** `36fdc0a196633586ee84e4cbd4ce85714c60b9bd` (main Stage 125, CI #1277 success; owner Hostinger deployment confirmed).
**Parent plan:** [Fixed closure tracker #250](https://github.com/Wisamit/nx7q9-vk42m-rp81t-z6core/issues/250).
**Master Scope:** §§5–8, 11, 17, 34, 37, 41, 63, 79–80, 87–88.

## Existing delivery — do not duplicate
- Stages 82–84: legacy referrers/sources, clients, organisms/antibiotics/comment template review/import.
- Stages 24–57 and 95: controlled catalog review/commit, unit, component, price and reference range governance.
- Stage 116: nine-class signed export including panel/package membership and price-list package items.
- Stage 117: strict **nine-class review-only admission** in `CONFIG_BUNDLE_REVIEW`; its commit endpoint deliberately blocks live writes.
- Stage 118: deidentified source MDB 15-table inventory/counts; explicitly no row identity proof or medical sign-off.
- Stage 119: selected specialty range table matching to configured test without activation.
- Stages 120–125: stronger clinical-rule approval, exact decimal and safe Delta/autoverification checks.

## Work to implement in THIS consolidated stage
1. Map safe reviewed package memberships, component/interval and package price changes to existing live master identities. Do not invent cross-organization identifiers, test names, prices, units, thresholds or reference intervals.
2. Implement distinct clinical and finance disposition, privilege, active-branch/department/organization scope, effective-date and signature checks **before** any live application. Use existing signed step-up conventions where policy dictates, with separate finance/clinical actor evidence and strong audit context.
3. Read immutable source evidence; enforce source/row version fingerprint, drift rejection, and idempotent CAS. Prevent republishing a spent review bundle or accepting a stale signed snapshot. A change must be atomic per approved change set or produce a clear no-write rejection.
4. Preserve historical clinical/range/price/package naming and report snapshots. Never mutate released observations, finalized invoices or published report contents; future effective-dated configurations only.
5. Strengthen source-to-staging evidence, distinguish Access file fingerprint from JSON import checksum, and provide a **reviewable per-source-row reconciliation disposition** with bounded privacy and no patient data. Counts alone are insufficient, and Stage 118 must not be described as certified migration.
6. Bilingual reviewer UX: what is safe to apply, what is blocked, the precise approved unit/branch/price-list/range context and why, and an audit/reconciliation trail.
7. Full synthetic Safety tests plus real MariaDB integration (two connections for idempotency and competing reviewers), all previous regression tests, TypeScript, ESLint, AR/EN/RTL, Next production build.

## Stop conditions / explicit external approvals
- Actual 15-table Access source counts and specialty value/range review need a trusted Windows/ACE run and qualified operator later; no invented source rows.
- No automatic activation for clinical ranges, specialist report templates, prices or patient-level data.
- Keep open Draft PR #128/#209 untouched until a separate exact semantic comparison and Stage 131 disposition.
- No Vercel; Hostinger owner deployment only after feature-head and merged-main CI SUCCESS.
- Complete source-mapping/cutover clinical and financial certification remains **blocked pending original evidence and qualified sign-off**, even if software closes successfully.

## Required merge gate
- [ ] Functional code implemented for the agreed reviewed composite workflow, not a review-only mock
- [ ] Finance/clinical sign-off and immutable historical value tests passed
- [ ] Source-lineage reconciliation evidence and review UI tested
- [ ] Exact feature SHA CI full SUCCESS
- [ ] Draft PR Ready and expected-head-SHA merge
- [ ] Independent main SHA CI full SUCCESS
- [ ] Owner confirms Hostinger publication
