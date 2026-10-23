# F8 — Configuration CSV/XLSX draft integrity batch (§87 with §86 boundaries)

## Verified pre-existing implementation

Prior Stages 133–138 already provide controlled tenant- and branch-scoped CSV/XLSX review uploads, many export kinds, an atomic signed JSON source bundle, source drift review, an independently governed F2 configuration process and strict DRAFT-only CSV_REVIEW staging. Do not confuse the review spreadsheets with a lossless import of the signed bundle or a universal activation pathway.

## Confirmed software defect and the correction

The pre-existing generic preview validator relied on permissive JavaScript date parsing for a test tariff and only limited the package tariff to the target DECIMAL(18,4) integer precision. A malformed day or oversized test price could therefore be presented as a warning-only review candidate, despite being ineligible for an exact governed activation. There was also no cross-row warning for tariff windows overlapping within the same spreadsheet file and no error on duplicate staged identities.

This batch adds a **CSV/XLSX-only** guard after the unchanged normalization:
- Strict UTC ISO calendar days or full UTC ISO timestamps, round-trip verified against actual Gregorian dates. No guess about jurisdiction, tax treatment, branch-local calendar interpretation or timezone offsets.
- Explicit DECIMAL(18,4) lexical limits for both test and package price candidates, without JS floating-point conversion or financial posting.
- Ambiguous repeated entity codes, components, and same price list + test/package + effective-start records flagged as errors **on all involved rows**, while distinct versions and different parents remain distinct.
- Overlapping tariff effective windows flagged on the involved rows for expert financial review; this checker does not silently decide a tariff winner or make any live changes.
- CSV and XLSX use the same canonical row validator, existing active tenant/branch/permissions, author-private staging, checksum, idempotent request key and append-only audit. Rows with findings stay visible as DRAFT evidence; nothing publishes.
- Regression coverage includes invalid Feb 29/Feb 30, valid leap day, exact maximum DECIMAL(18,4), amount overflows, timezone ambiguities, multi-row collisions and CSV/XLSX parity.

## Explicit remaining closure matrix

| Scope | Engineering delivered / current limitation | External gate |
| --- | --- | --- |
| §75 clinical/reflex/interference rules | Existing configurable rule infrastructure; this batch does not introduce a vendor/sample threshold or auto-release | Signed device/medical policy BLOCKED_EXTERNAL |
| §86 currency/tax | The amount/window preview rejects ambiguous or inexact tariffs; **no** tax rates, currency conversions, exemptions or financial postings changed | Jurisdiction and owner/accountant finance policy BLOCKED_EXTERNAL |
| §87 configuration import/export | This closes a proven CSV/XLSX DRAFT-integrity gap. Full field-level round-trip and independently approved activation across every supported type remain PARTIAL; signed bundle and existing governed F2 apply must not be bypassed | Qualified clinical/finance approval still required |
| §88 legacy migration | Nothing uploaded from the private Access MDB; original source-row evidence and mapping remain separate, tenant-private, with reconciliation and reviewer gate | Private original source and expert/owner validation BLOCKED_EXTERNAL |

**F7:** separate finite triage doc; 0/486 protected browser captures, no owner visual signoff. **F8:** 0/88 qualified UAT cases and no seven reviewer approvals; NO_GO. Repository is PUBLIC. No PHI, source MDB, fiscal rates, secrets or real patient records introduced.

**Release rule:** PR latest head full CI SUCCESS; compare branch SHA and PR head; merge using expected HEAD only; verify independent main push CI on actual merge SHA. An automated pass does not verify Hostinger deployment, device commissioning, a backup restore or medical readiness.
