# Stage 138 — §87 configuration-review parity

| Entity | Paged CSV/XLSX export | Atomic signed JSON bundle | CSV/XLSX import DRAFT | Direct activation |
| --- | --- | --- | --- | --- |
| TEST | Yes | Yes | Partial identity | No |
| COMPONENT | Yes | Yes | Partial mapping | No |
| UNIT | Yes | Yes | Limited | No |
| CONTAINER | **Now yes** (code, bilingual name, tubeColor, additive, status) | **Now yes** (tenant-constrained identity and current master match) | Existing limited code/name | No |
| PANEL | Yes | Yes | Explicit membership | No |
| PACKAGE | Yes | Yes | Explicit membership | No |
| REFERENCE_INTERVAL | Yes | Yes | Selected interval values | No |
| PRICE_LIST | Yes | Yes | **Now DRAFT-only for organization/authorized active branch; clinical/finance signoff outstanding** | No |
| PRICE_LIST_ITEM | Yes | Yes | Limited tariff data | No |
| PRICE_LIST_PACKAGE_ITEM | Yes | Yes | Limited tariff data | No |

Source spreadsheet exports contain provenance and flattened fields, and **are NOT directly accepted as import templates or lossless restores**. Signed JSON is evidence for a separate governed DRAFT review, not an approval. Stage 138 CONTAINER bundle review checks organization and live identity/metadata before retaining source evidence. No clinical rule, financial policy, published history or source data is modified. Full field-level roundtrip/activation and §75/86/88 plus Stage 132 signed UAT remain open in Issue #250.

Financial master CSV/XLSX preview now requires `pricing.manage`, author identity and live authorized branch scope; invalid currency, scope, priority and non-calendar dates are flagged. No price-list or tax activation is provided. Source export workbooks still do not directly match canonical staging headers.

Two-connection MariaDB regression now verifies source container organization isolation, read-snapshot consistency, and that branch tariffs are excluded from another branch's generic review scope. The CI workflow invokes this test explicitly.
