# Stage 23 — Verifiable Medical Validation Evidence

**Base main**: `bef262f63821036cc481a6bfc1775fa0bc960877`; feature rollout to Hostinger explicitly confirmed by owner after CI #879 SUCCESS.

## Clinical scope and audit result

The deployed LIS **already has** configuration-driven staged result review, scope precedence (TEST > DEPARTMENT > ORGANIZATION, branch override), effective-dated policies, independent `results.technical_review` and `results.medical_validate` permissions, medical return-for-correction, technical reviewer separation, QC and custody gates, immutable released report versions and review-event history.

Stage 23 addresses one concrete approval integrity gap: the approval endpoint previously required `technicalReviewedAt` but could proceed with incomplete technical-approval provenance. In particular an absent human technical reviewer was treated similarly to a legitimate automated review, and a malformed/altered JSON policy snapshot could be interpreted using truthy values. **No new medical workflow is invented or historically rewritten.**

## Increment implemented

1. The medical approval endpoint loads the **latest technical-stage review evidence** for the same result version (approved or returned, latest by time/id) and calls `medicalApprovalEvidenceError` before any approval transaction.
2. The policy must be an explicitly CONFIGURED, medically validating snapshot with a valid same-reviewer boolean, identified policy and scope matching the current result's test/department/performing branch. The same clinical scope, reviewer separation and policy identity must match the snapshot recorded at technical approval.
3. The latest technical review must be APPROVED and timestamp-exact with the result's technical-review timestamp. A human review requires matching non-null reviewer IDs. A legitimate **automated technical review** is permitted only with `autoVerified=true`, an automated approved review event and no fabricated human reviewer.
4. For manual review, a medical approver must differ from the technical reviewer unless that **same snapshot** expressly allows the same user.
5. New failures are explicit HTTP 409 results with bilingual explanatory UI messages. No automatic conversion, inferred medical decision, backfilled reviewer, historical clinical data change or altered release PDF.
6. The existing medical RETURN action remains available for correction of results already in medical stage; only the APPROVE path has the stricter technical evidence gate.

## Tests

- `tests/stage-23-medical-validation-evidence.test.ts`: missing/mismatched approvals, return-vs-approved, policy scope, revision timestamps, human/automated review, same reviewer and malformed/migrated snapshots.
- `tests/stage-23-medical-validation-mariadb.integration.test.ts`: two real MariaDB connections exercising persisted clinical review records, missing evidence, returned reviews, policy mismatch, automated-review provenance and wrong-branch snapshots without any release.
- Added live MariaDB Stage 23 to `.github/workflows/ci.yml` alongside all previous safety and integration tests, Prisma migration checks, TypeScript, ESLint, Arabic/English UI and Next.js production build.

## Deferred and remaining

- This increment does **not** claim that all specialty pathways (hematology, histopathology, cytology, coagulation, pathology-specific signer rules, etc.) are certified or configured; Master Scope §§1–88 remains the target, with no deliberate removal.
- No changes to third-party patient portals or analyzer connectivity. Analyzer Bridge PR #128 remains Draft, OPEN and UNMERGED, pending independent audit.
- Physical device, clinical, manual UI, acceptance, backup restoration and infrastructure UAT **remain deferred** until all application work is complete; automated test success is not equivalent to clinical validation.
- Hostinger release requires independent owner confirmation on the exact merged main SHA, not merely green CI.
