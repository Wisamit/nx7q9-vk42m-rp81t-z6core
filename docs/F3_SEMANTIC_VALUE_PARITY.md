# F3 — Private field-value semantic reconciliation (synthetic engineering)

**Owner requirement:** finish software using synthetic input; do not wait for
the real Access file, laboratory professionals or production approval.
This increment is the **private in-memory field comparison primitive**, not
a standalone importer, verified Windows ACE extraction, live target query or
a source-to-clinical-value certification.

## Contract

`reconcileF3SemanticValues` accepts:

- Explicit table/target policy pairs from the 15 allowlisted Access source
  families. One Access table may legitimately have distinct policies for
  target types (for example, test versus component, individual versus package
  price). Every participating source and target field must be named exactly;
  missing fields, extra fields, duplicate columns or unknown types fail closed.
- Approved, previously reconciled source row identities with `rowDigest`
  and occurrence, provided only inside a trusted private workstation process.
  The comparator does **not** authenticate a client-provided classification;
  callers must first independently verify full HMAC lineage and that the
  target belongs to the right tenant/branch.
- Corresponding **local-only** source and target semantic projections, with
  typed conversions: case-sensitive NFC strings, explicit opt-in case-folded
  text, exact decimal strings, integers without JS Number, booleans, ISO dates
  and set-normalized composite member codes.

The output includes **only** per-table and per-target total row counts, match
counts, mismatch counts and configured target field **names**. It contains no
legacy names, prices, clinical ranges, HMAC keys/digests, raw source rows,
target UUIDs or full result snapshots.

## Engineering test coverage

Synthetic tests cover all 15 named legacy source families, split
`price` source to two target types, exact DECIMAL changes, clinical integer
differences, composite membership ordering, Unicode/case sensitivity, invalid
dates, duplicate source identities, rejected unapproved mapping and extra
private source columns. No actual live user/patient data is used.

## Remaining wiring and operational boundary

The Windows ACE private extractor and the authenticated read-only MariaDB
target exporter must provide explicit source and target semantic projections
under a **locally approved mapping policy**, then call this primitive only
after full HMAC row-key and tenant/target lineage reconciliation. Policies
cannot be invented from a filename or a matching UUID.

The implementation must not transmit value projections, issue operational
approval or modify the catalog. Actual MDB normalization rules, field
renames, culture/organism/antibiotic equivalence, price contracts, range
applicability, bilingual comments and independent professional acceptance
remain F3 future integration / F8 operational verification tasks.
