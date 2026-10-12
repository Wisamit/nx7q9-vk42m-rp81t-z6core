# Stage 94 — Immutable Order-Level Clinical Handover & Independent Acknowledgement

## Checkpoint & scope
- Base: `8b1308f50a0f09b6b08b9d88db306cfd4eed99b6` — owner-confirmed Hostinger deployment, `main` CI #1129 SUCCESS.
- Master Scope §§14, 37, 41: operational order-level clinical annotations beyond the original registration note. These are **not** the report-level approved interpretations delivered in Stage 92. Existing component/test comments and result validation are reused, not changed.
- The old `LabOrder.clinicalNotes` value remains unchanged as the registration snapshot. No published report, result or invoice is mutated.

## Workflow / API
1. Staff with `orders.view` can access `/orders/[id]/clinical-handover` only for an order in a permitted branch. Full chronological history is paginated at 50 entries with explicit total and previous/next.
2. `orders.create`, a valid active **ordering** branch selected as the session's active branch, and tenant/branch membership are required for writes. Cancelled orders cannot receive new notes.
3. A note records immutable clinical text (Arabic or English, tagged locale), category (clinical context, collection instruction, lab handover, quality caution), author, time, order, branch and a request fingerprint. Author optionally requires an independent read acknowledgement.
4. A new note uses a UUID client request key. The `organizationId + authorId + clientRequestId` database constraint makes exact retries idempotent; reused keys with changed content fail.
5. Correction requires a 10–1000-character reason; author or staff with `results.medical_validate` may correct. The transaction locks the order and target note, marks the old revision `SUPERSEDED` while **preserving its exact body**, and creates a new revision in the same thread. Per-thread revision, predecessor uniqueness and atomic status compare-and-swap prevent forks. Corrections cannot auto-inherit previous acknowledgements.
6. Independent acknowledgement requires `orders.view`, active ordering-branch scope, an active note flagged as requiring acknowledgement, and a different user than the author; unique per note/user and audit-recorded. Acknowledgement of an already retired/replaced revision is refused. Repeated acknowledgement of the same active revision is safe.
7. Author or authorized medical validator with `orders.create` may retract an active note with a mandatory reason. Retraction records who/when/why and **does not delete historical content or acknowledgements**.
8. Order details link to clinical handover and show the acting user's outstanding independent acknowledgements.
9. **No portal disclosure:** clinical operational handover is visible only in staff order pages; deliberately not added to diagnostic report snapshots, doctor/patient/corporate portals, notifications, invoices or HL7/FHIR. It does not supersede Stage 92 medically approved report interpretations.

## Clinical / database safeguards
- Additive migration: `20261012223000_order_clinical_handover` with 2 new tables and no changes to existing rows.
- InnoDB FKs, unique idempotency, thread/revision and acknowledgement keys. No table-per-test.
- Every write uses `Serializable` transaction and **shared order-row lock before note-row lock**, with active branch/user verification inside the transaction. This serializes writers on the same order and avoids stale status changes. All clinically significant transitions append audit evidence; audit stores fingerprints/metadata, not a second full clinical text copy.
- Staff must choose ordering branch to write/ack; read access remains controlled by their allowed branch scope. Historical clinic and finance values stay immutable.
- No automatic clinical meaning, diagnosis, result validation, report amendment or critical-value acknowledgment is inferred from a read acknowledgement.

## Automated gates
- Unit/source safety: bilingual text validations, strictly bounded categories and metadata, corrections requiring reasons, idempotency fingerprint drift, branch/permissions, historical status transitions, no portal/report inclusion.
- Real MariaDB (2 connections): tenant/branch filter, uniqueness, single-current revision, race on shared order lock, correction with historic text intact, acknowledgements retained only for original revision, audit integrity and no stale retraction.
- CI: Prisma migrate/status/generate, full safety tests, this Stage 94 MariaDB suite + all existing integration suites, TypeScript, ESLint, Arabic/English UI checks and Next.js production build. Feature CI on **exact last SHA** and independent merged-main CI on exact merge SHA.

## Deployment and deferred acceptance
- Back up Hostinger production database before the next `npm run build` because it runs `prisma migrate deploy`; never use `db push`.
- No additional environment variables. Do not claim deployed until owner confirms exact merged SHA.
- Manual UAT with clinicians/operators, hardware, analyzer, printers, regulatory clinical sign-off and final physical acceptance remain deferred per owner instruction until the entire LIS is ready.
- Draft PR #128 Analyzer Bridge and superseded Draft PR #209 remain untouched.
