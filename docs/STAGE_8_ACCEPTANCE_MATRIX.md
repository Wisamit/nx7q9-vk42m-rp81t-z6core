# Stage 8 — Reports & Delivery Acceptance Matrix

**Base commit:** `fefecab6dc72929daf3f089befbdc5fcc85cfab3` (Stage 7, owner confirmed Hostinger deployment).  
**Working branch:** `stage-8-reporting-delivery-completion`.  
**Roadmap mapping:** Core report delivery scope described as *Phase 7 — Reports and Delivery* in `docs/PHASE_7_EVIDENCE_AUDIT.md`. The user-facing Stage 8 numbering counts the preceding Stage 7 Laboratory Results separately.

## Functional inventory

| Contract | Existing feature | Stage 8 safety/acceptance requirements |
| --- | --- | --- |
| Versioned templates | `ReportTemplate`/`ReportTemplateVersion` designer, per-branch selection | Exact template version and configuration captured in immutable `DiagnosticReportVersion.templateSnapshot`; changed templates do not mutate old releases |
| Bilingual PDF | English/Arabic/bilingual report and browser PDF export | Renders the released `contentSnapshot`, not latest test catalog; browser preparation is RECORDED, not falsely DELIVERED to a recipient |
| Branch branding/signatures | Report branch snapshot, validator/releaser actors and issue times | Display source snapshots in released content; no inferred signatures |
| QR verification | Cryptographic per-version verification token and public limited verification page | Canonical configured HTTPS origin; no Host-header poisoning; withdrawn or superseded versions must not carry a VALID/CURRENT mark |
| Partial/final/amended | Immutable report versions, supersession chain, amendment reason | Concurrent releases may not allocate duplicate versions or release same result twice; report parent serialized with row lock |
| Print and download history | `ReportDeliveryEvent` | Browser can record only PRINT and DOWNLOAD attempts, with server-owned RECORDED status; no fake provider deliveries |
| Secure email/SMS/WhatsApp | Verified recipient portal account, notification queue, gateway integration, provider reconciliation | Portal links are generated only from trusted configured origin; dispatcher rechecks report status before sending queued notification |
| Patient/referrer/corporate portal | Authenticated report access and audit on version viewed | Retracted clinical report body must be unavailable; superseded versions must carry prominent warning; no fake delivered event for withdrawn report |
| Branch/tenant scope | Reports, report delivery and outbound endpoints | Organization and branch restrictions continue to apply, with no free-text recipient substitutions |
| Historical demographic safety | Age/sex clinical snapshot at order registration | New report version must use order-time clinical sex/DOB/recorded age, not mutable current patient demographics |

## CI evidence required

- Source and pure policy regressions: `tests/stage-8-report-delivery-safety.test.ts`.
- MariaDB two-connection/real transaction evidence: `tests/report-version-mariadb.integration.test.ts` — result CAS and serialized report version allocation.
- GitHub CI: migration deploy/status, Prisma generate, safety suite, specimen/result/report DB integration, TypeScript, ESLint, Arabic/English UX tests, Next.js production build.
- Exact-HEAD green run is required before declaring this Stage 8 PR deployable.

## Clinical and operational constraints

- External EMAIL/SMS/WHATSAPP gateway sending requires real provider configuration and later end-to-end provider acceptance. **Code-level integration is not proof that an external SMS/email/WhatsApp was actually delivered**.
- A server log of PRINT or PDF_PREPARED is **not** evidence that physical printing or file download completed or that the recipient acknowledged it.
- Report notification bodies must link only to an authenticated portal. The public QR verification page must not leak full clinical values.
- Historical report versions remain immutable. The portal keeps superseded historical reports visibly marked; withdrawn reports cannot disclose values or register delivery.
- For production, set `NEXT_PUBLIC_APP_URL` to the **canonical absolute HTTPS origin** (e.g. `https://lab.example.org`, without a path, query, fragment or credentials). Insecure/missing URL fails closed for outbound links; QR is omitted rather than guessing from Host headers.
- Owner expressly defers **all manual UI/hardware UAT** until whole-project acceptance. Do not mark this testing as passed and do not imply clinical operational certification.
- Application engineering completion can proceed independently of provider accounts/physical printers, provided these integrations remain safely gated and later acceptance work is clearly recorded.

## Release checkpoints

- [ ] Required version-history and delivery-code changes complete
- [ ] MariaDB migration and two-connection integration PASS on exact PR SHA
- [ ] TypeScript, lint, safety, locale/theme and Next.js build PASS on exact PR SHA
- [ ] PR reviewed and merged only after green CI
- [ ] Post-merge `main` CI green and Hostinger deployment independently confirmed
- [ ] Full-project manual UI, devices, provider accounts and clinical signoff — DEFERRED, not passed
