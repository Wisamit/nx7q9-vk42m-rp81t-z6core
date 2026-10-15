# Stage 141 — §87 signed configuration bundle drift parity

## Confirmed defect on Stage 140 main
The native JSON bundle export and same-tenant read-only review supported ten master
groups, including CONTAINER. The independent `bundle-drift` route kept a
nine-type local list. It would skip the live CONTAINER read and then attempt
to serialize an absent live record during per-row drift comparison, so a
valid container source could crash the review. A composite bundle with a
container could therefore block its whole drift inspection.

Stage 140 also added status/source/referrer/client/contract identifiers in
nested pricing context for exported PRICE_LIST_ITEM and
PRICE_LIST_PACKAGE_ITEM. The drift route still selected the shorter nested
context, producing spurious field differences even when nothing had changed.

## Fix
- Derive the drift type list from the same exported `catalogExportTypes` set.
- Query CONTAINER by **both** organization ID and source immutable record ID.
  Compare code, both names, tubeColor, additive, status and timestamps exactly
  as they are serialized by the native JSON export.
- Fetch the full nested price-list fields introduced in Stage 140 for each
  priced test/package. Do not treat a pricing scope change as invisible.
- Reject any missing or inaccessible live master with an explicit 403, never
  silently compare with an undefined record or emit a false unchanged state.
- No source or live clinical/price values are returned in drift payloads:
  only changed field names, generic dispositions and signed observations.
- No new ability to authorize, import, activate or overwrite live masters.

## Tests
- Ten-class export/drift parity and exact nested tariff field selectors.
- Same source snapshots unchanged; tube additive/color and price-list
  scope changes produce field-only DRIFTED findings.
- Independent MariaDB reader/writer connections test tenant visibility,
  branch pricing, repeatable-read coherence under concurrent master update,
  and accurate drift after commit.
- Full safety suite, UI AR/EN and theme checks, MariaDB integrations and Next
  production build through CI, followed by independent main verification.

## Outstanding releases
Section §87 still lacks independently governed, field-complete canonical
spreadsheet activation. §§75/86/88 and Stage132 qualified UAT require separate
source/owner/clinical/finance/device evidence; Issue #250 remains OPEN with
NO_GO. Owner-mandated full page/modal/theme/timezone acceptance in Issue #265
remains OPEN. No runtime Hostinger deployment is implied by merged CI.
