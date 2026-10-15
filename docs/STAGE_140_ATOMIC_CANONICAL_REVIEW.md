# Stage 140: Canonical spreadsheet review

This change adds a separate export of CSV/XLSX files matching the existing DRAFT staging template for nine supported catalog entity groups. The conversion reads one atomic, tenant-scoped source export and checks each generated row using the existing parser and validation rules. The source JSON export remains available and unchanged.

The canonical spreadsheet is NOT lossless and NOT a restore format. It intentionally omits specialist fields that are unsupported by the review template. Reference intervals require manual clinical reconciliation. Financial contract types and ambiguous dates are rejected, not inferred. Prices retain exact decimal strings. Source UUIDs are retained as legacyKey for reconciliation. Previously released financial and clinical records are not changed. This introduces no production activation.

Safety tests cover nine CSV/XLSX review mappings, rejected unsafe inputs and existing DRAFT-only commitment restrictions. Independent MariaDB connections test the branch/tenant scope and a concurrent source revision. Full field round trip and governed activation remain outstanding.

Issues #250 and #265 remain OPEN. Signed clinical, finance, hardware and real-world UAT must be carried out independently; an automated test success is not production authorization. The owner-requested full UI audit of every page is separately required before final acceptance.
