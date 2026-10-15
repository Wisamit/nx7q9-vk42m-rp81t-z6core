# Stage 132 — Real-World Final UAT & Formal GO/NO-GO

**Acceptance state: NOT EXECUTED / CLINICAL GO NOT GRANTED.** Owner confirmed successful Hostinger deployment of Stage 131 software RC SHA `cc14d531887bc00299d0728d2fcc95090d7493fd`; independent main CI #1352 passed on that exact SHA. This only proves software deployment/automation, not real clinical, financial, security, vendor or disaster-recovery UAT.

## Traceability

`docs/STAGE_132_UAT_CASES.json` contains all **88 Master Scope sections**, preserving Stage 131 classifications, source code anchors, synthetic test anchors, each section's outstanding real-world evidence, assigned acceptance group and **NOT_EXECUTED** status. No Master Scope section has been dropped or deemed real-world PASS. Software tests do not authenticate clinical thresholds, qualified signatures, actual physical lab devices, financial settlement or recovered backups.

The owner's deferral of manual/device/clinical UAT until software completion is respected. This Stage 132 commit is preparation and metadata validation, not execution. No patient data, credential, instrument configuration, released result, fee schedule or database migration changes are included.

## Seven independent acceptance gates

| Gate | Required qualified role | Evidence demanded |
| --- | --- | --- |
| CLINICAL_POLICY | LAB_MEDICAL_DIRECTOR | Approved catalog, reference/critical/Delta/interference/reflex/WG rules; microbiology AST; manual and medical release; critical communication/readback, amendments and signed reports |
| SPECIMEN_DEVICE | LAB_OPERATIONS_LEAD | Two identifiers, physical label/scan, aliquot and home collection, inter-branch shipment and receiving custody, equipment/lot/expiry, QC, calibration, incident/CAPA, competency |
| FINANCE | FINANCE_AUTHORIZED_SIGNATORY | Real branch/client tariff/tax/currency policy, invoice/payment/refund, exact idempotent retries, credit, independently counted shift, ledger and profitability reconciliation |
| PRIVACY_SECURITY | PRIVACY_SECURITY_OFFICER | Patient-directory PHI visibility, branch scoping and consent, doctor/corporate portals, attachment privacy, roles/MFA/step-up, TLS/firewall/secrets and independent penetration testing |
| PROVIDER_INTEROP | INTEGRATION_VENDOR_OWNER | Real ASTM/HL7 bidirectional analyzers, signed vendor mapping/ACK/QC blocking, authorized send-out, actual SMS/email/WhatsApp provider delivery/receipt and consent |
| DR_OPERATIONS | HOSTINGER_DR_OPERATOR | Real offsite encrypted backup, independent download and **timed isolated restore** of historical reports, specimen and finance, attachment BLOB integrity, signed RPO/RTO; branch operations, bilingual print/QR, contingencies |
| OWNER_FINAL | ORGANIZATION_OWNER | All 88 evidenced, qualified separate approvals, blockers/risks closed or formally dispositioned, explicit dated owner GO/NO-GO |

## Mandatory field scenarios

1. **Identity + intake:** central patient across branches, duplicate merge authority, ID and consent, order questions, immutable catalog/range/price snapshot.
2. **Financial:** genuine branch/client prices/taxes and payment methods; exact retry on PAID invoice, refunded/void changed-state conflict; independent cashier counts/closures by currency with audit.
3. **Custody:** patient identifiers→barcode print/scan→collection→manifest→physical transfer→receiving branch→rejection/recollect and aliquot; incorrect barcode or transit-state release must fail closed.
4. **Medical:** actual device ASTM/HL7 and ACK, analyzer data mapping, QC/Westgard, critical/delta/reference/interference rules; validate only by authorized signatories; versioned partial/final/report corrections, PDF/Arabic-English/QR physically verified.
5. **Partners and privacy:** signed consent, real provider receipt, patient/doctor/corporate data disclosure and revocation, tenant/branch isolation.
6. **Support:** real reagents/lots, QC devices/calibration, expiry and CAPA, signed lab SOP/staff competency, branch reports and queues.
7. **Data and policy blockers:** **§75** interference rule semantics; **§86** local jurisdiction/currencies/tax; **§87** CSV/Excel native XLSX import/export and activation parity; **§88** legacy MDB source-row reconciliation and approval of migration scope. These four remain OPEN from Stage 131 until independently resolved, including new software if policy shows a code gap.
8. **Disaster recovery:** verify archive offsite retrieval, restore into a new isolated schema (never production), check report revisions, result/financial snapshots, audit/attachment SHA-256, measure actual RPO/RTO, credential/secret controls, incident stop/rollback.

Each § has its particular requirement and evidence target in the 88-row register. The above journeys do **not** automatically cover every requested feature.

## Evidence handling / operator commands

Evidence must remain in an access-restricted external system. No PHI, name, result, invoice, secret, raw analyzer payload or live MDB may be committed to GitHub. For every §, approved evidence metadata must describe `section`, `status: PASS`, at least one `evidence: [{ref,sha256}]` pointing to a real private artifact, `executedBy`, distinct `reviewedBy`, `executedAt`, `reviewedAt`. Each of seven gate signatures requires `gateId`, exact `reviewerRole`, `reviewerId`, `decision: APPROVED`, `decidedAt`, private `evidenceRef`. Root private manifest includes frozen `releaseCandidateSha`, `environment: HOSTINGER_PRODUCTION`, `openCriticalDefects: 0`, **all 88 cases** and **all seven gateSignoffs**.

Repository structural self-check (CI-safe):
```sh
node scripts/operations/stage132-acceptance-gate.mjs --check-template
```

Optional **only after real UAT** (private OS filesystem, never commit manifest):
```sh
node scripts/operations/stage132-acceptance-gate.mjs --assess /private/path/uat-evidence.json
```

Incomplete/missing evidence returns NO_GO and nonzero exit. Even syntactically complete approval metadata returns `METADATA_COMPLETE_REQUIRES_HUMAN_SIGNOFF` — **never grants clinical GO**. This script cannot inspect clinical evidence, check signatures, approve VAT/tax applicability, certify physical devices, check signed attestations or determine legal fitness.

**Stop immediately:** wrong patient/specimen; unsafe critical alert/validation; altered released report history; unauthorized cross-branch PHI; wrong/duplicate charge; unverifiable offsite restore, unsafe analyzer mapping, compromised key/consent. Open quality incident, preserve evidence, correct in new version, retest and reconvene qualified stakeholders. Final GO/NO-GO requires an explicit signed owner decision separate from CI and this checklist.

**Repo guardrails:** PR #128/#209 stay open Draft (never auto-merge); Hostinger only; no Vercel; clinical result snapshots and historical prices cannot be rewritten. The Stage 132 preparation branch is *not* a production change requiring immediate Hostinger redeployment.
