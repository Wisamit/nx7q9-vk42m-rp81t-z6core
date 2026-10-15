# Stage 142 — independent analyzer mapping approval and live branch permissions

## Proven clinical governance gap
On the previous production branch, the separate `analyzers.mappings.approve`
permission could be held by the person who drafted an analyzer-to-LIS test
mapping. The PATCH transition checked cached session permission/branch scope
before taking its per-analyzer-code governance lock but did not re-check
live grants inside that transaction. As a result self-approved mappings,
or approval/retirement based on privileges revoked between session resolution
and the write, were not explicitly forbidden. Analyzer mappings are clinically
significant because they determine where raw device results enter the LIS.

## Fix (no schema migration)
- Enforce independent reviewer identity during DRAFT -> APPROVED: creator must
  be known; `createdByUserId` cannot equal current approver; no previous
  approval or retirement provenance may exist.
- After the existing serialized `clinicalRuleGovernanceLock` upsert, re-read
  user, live organization, active organization-owned role and persisted
  `analyzers.mappings.approve` grant, and currently authorized **active
  branch** access. Intersect with the original session branch scope.
- Perform this live check for both approval and retirement and **before**
  any effective predecessor closure, new unit snapshot, status update or
  clinical governance audit.
- The original test/component, calculated component, unit and period-overlap
  checks remain in place. Approved mappings retain their prior snapshot,
  historical observations and retirement event.
- Show clear bilingual UI messages and suppress an author or creator-unknown
  DRAFT approval button; retirement remains available to authorized staff.

## Evidence
- Pure transition and fake transaction tests of unknown/self authors, stale
  user/role/org/branch grants and status provenance.
- Two-connection MariaDB integration of live cross-tenant/branch/role
  eligibility and same-identity lock contention, grant and status revocations.
- Full CI TypeScript, lint, safety, MariaDB, AR/EN+theme and production build;
  independent main CI must pass the exact merged SHA.

## Boundaries and remaining release gates
This is a clinical fail-closed governance repair, **not analyzer vendor
validation, unit conversion, revised clinical interference rules, or a
clinical-release signoff**. Old DRAFT rows whose authorship is unknown cannot
be approved through this route; they need a separately governed reconciliation
process, never a guessed author. No automatic mapping activation or published
result changes are introduced.

Issue #250 remains OPEN / NO_GO pending qualified device, clinical, billing,
disaster-recovery and 88-case UAT evidence, including §§75/86/87/88.
Issue #265 remains OPEN for the owner-required every-screen UI/UX review,
centrally configured colors and local date/time formats, and compact centered
form dialogs. This stage does not claim that review is complete.
