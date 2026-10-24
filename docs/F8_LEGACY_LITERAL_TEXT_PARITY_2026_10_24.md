# F8 §88 — Exact legacy textual semantic parity (2026-10-24)

Base `main=1ffaa910fd8678b39dce96e8e063c9503dae578b` from merged PR #388. Original 88 sections in `02_MASTER_SCOPE.md` remain in force.

## Source-confirmed mismatch

The private Access migration's typed semantic comparator called both `TEXT` and `TEXT_CASEFOLD` through `.normalize("NFC").trim()` before comparing. As a result `" Report "` versus `"Report"`, tabs/newline suffixes or composed-versus-decomposed Unicode were silently declared equal even for ordinary literal `TEXT` source-policy fields. This can mask display-significant source content changes in report text/comments/names, and offers no explicit reviewer choice to permit text canonicalization. Earlier §88 safeguards already made profile MEMBER_CODES ordered by default; textual source parity deserves the same discipline.

## Finite guarded correction

- `TEXT`: compare literal source and target strings exactly, including whitespace, tabs, newlines and Unicode composition. No implicit trim, Unicode canonicalization or case folding.
- `TEXT_CASEFOLD`: **only** locale-specific case-insensitive equivalence; keep whitespace and Unicode composition differences reportable.
- `TEXT_NORMALIZED`: optional, explicitly selected legacy-compatible NFC + trim equivalence, case-sensitive.
- `TEXT_CASEFOLD_NORMALIZED`: optional, explicitly selected legacy-compatible NFC + trim + English casefold.
- Typed policy whitelist is closed: any unknown/misspelled comparator fails closed, rather than guessing semantics.
- Safety regressions cover literal layout drift, bilingual Unicode composition, explicit opt-in equivalence, invalid numeric-as-text values, source length and **aggregate-only** output with no original content, HMAC, raw report text or patient data.
- No trusted policy is auto-changed in persistent data: the private offline workstation must choose/approve comparator types. No original MDB byte-level pedigree or source-to-target clinical equivalence is claimed.
- Historical result reports, invoice values, reference intervals and live configuration remain untouched; this is a private/synthetic parity evaluator, not an import or activation flow.

## Acceptance gates unchanged

§88 original MDB provenance and independently qualified source-row reconciliation still **BLOCKED_EXTERNAL**. §§75/86/87 vendor-specific clinical thresholds, owner/accountant policy and activation approvals remain separate. F7 protected browser 0/486, F8 qualified real-world UAT 0/88, seven independent signoffs missing: **NO_GO**. No Hostinger deployment, analyzer field qualification or restore claim.

Required merge discipline: exact current feature HEAD full CI COMPLETED SUCCESS, expected-head merge, then independent `main` push CI COMPLETED SUCCESS on resulting merge SHA. Do not request manual owner UAT during development.
