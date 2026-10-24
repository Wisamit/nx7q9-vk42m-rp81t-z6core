# F8 §75 — Analyzer original-to-normalized observation integrity (2026-10-24)

**Verified base:** `main=953f8299a55a78a934b85e4ea47000a94e4f6237`, independent main push CI #40059440823 COMPLETED SUCCESS. All 88 original Master Scope sections preserved.

## Verified source-level safety gap

Existing `/api/integrations/analyzers/[id]/results` correctly authenticates the Analyzer Bridge, retrieves its persisted original HL7/ASTM message, scans raw clinical qualifier fields, enforces mapping/physical barcode custody and never automatically releases results. However, it did not verify that the Bridge's submitted normalized `observationId,barcode,analyzerTestCode,rawValue,rawUnit` values were derived from THAT raw message. A compromised, faulty or misconfigured Bridge could send a clean original `OBX|...|5.2` then a normalized `rawValue=9999` and those values would independently pass the raw qualifier scan. Similarly a forged barcode might accidentally match a valid specimen in the analyzer's branch.

## Engineering remediation

- Add `verifyOriginalAnalyzerObservationBinding` and require it to succeed **after** the existing independent raw clinical qualifier gate but **before** lookup/staging or any LIS result mutation. The original instrument message must retain an exact SHA-256 match to its stored `AnalyzerMessage.payloadHash`, not simply have a plausible payload.
- For the deliberately supported HL7 ORU^R01 subset, derive exact message control ID and every `OBR/OBX` observation ordinal, the raw test code, literal value, literal unit, and specimen barcode. Supported specimen candidates are `OBR-3` and `SPM-2`; if both are nonempty and different the original cannot be unambiguously rebound without a currently approved LIS-side vendor profile: **409 review**, not guessed source. Reject late SPM after OBX.
- For approved ASTM E1394 subset, bind the message ID to `astm-<SHA256 of full original payload>`, derive exact per-order/per-result observation IDs and the raw O/R barcode, test code, literal value and unit.
- Require exactly one normalized observation for **every original observation**. No partial payload, swapped test, swapped barcode, fabricated result value, unit mismatch, duplicate identifier, re-used ID, or silently trimmed result may enter ordinary analyzer staging. Observation ordering can change because immutable IDs, not presentation positions, are compared.
- A mismatch replies `analyzer_normalized_payload_requires_review` with generic non-PHI reason and HTTP 409; the original raw AnalyzerMessage remains retained and no AnalyzerResultImport is created from that request.
- Dedicated synthetic HL7 and ASTM tests cover both full correct paths, results, barcodes, IDs, units, SHA tampering, missing/duplicate observations, ambiguous specimen sources, and source-level ordering of gates. No original patient, specimen, instrument secrets or vendor configuration enters public GitHub.

## Explicit clinical boundary

This authenticates ONLY the exact supported syntactic projection against the persisted bytes. It DOES NOT provide vendor-specific HIL/hemolysis/lipemia/icterus thresholds, clinical result validity, corrective reporting rules, QC authorization, analyzer commissioning, reference interval approval, release authority or patient barcode source attestation. Actual devices with both OBR-3 and SPM-2 different require a signed vendor/profile decision before staging; no general first-match fallback.

**§75** partial engineering safety progress; signed medical/vendor interference policy still **BLOCKED_EXTERNAL**. §86 local tax/currency/accounting decisions still require owner + qualified accountant. §87 full protected field-level activation and §88 private original MDB source-row parity/signoff not established. 88 Master Scope sections remain. F7 protected browser 0/486 and F8 real device/qualified UAT 0/88, seven independent signoffs missing: **NO_GO**. This is not proof of Hostinger deployment or commissioning.

**Merge gate:** full feature HEAD CI COMPLETED SUCCESS; compare PR branch SHA; merge only with `expected_head_sha`; independent main push CI COMPLETED SUCCESS on exact merge SHA. No owner manual/device tests requested during remaining software work.
