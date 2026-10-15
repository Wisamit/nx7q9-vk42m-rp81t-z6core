# Stage 139 — Report template version history and independent approval (§81)

## Verified software gap
The old activation route allowed direct DRAFT → EFFECTIVE, accepted arbitrary effectiveFrom
(past or future), retired current versions with an unvalidated effectiveTo, and did not
serialize competing activation requests. The resolver filtered only EFFECTIVE versions,
making retired versions invisible for historical as-of lookups.

## Software hardening
- DRAFT is now approval-only, by a **different** current authorized user, with
  explicit confirmation and free-text audit reason. The approval transaction uses a
  tenant-specific template row lock, live role and branch grant rechecks and CAS.
- Activation only accepts empty JSON `{}`, uses one server time inside a locked
  SERIALIZABLE transaction, and requires independently APPROVED provenance.
  Arbitrary backdated/future scheduling and legacy auto-approval are rejected.
- Exactly zero or one existing EFFECTIVE version is allowed. Its end is set
  at the new immediate activation time only, never in the past, and the old
  version remains RETIRED with the exact effective interval for historic lookups.
- The resolver includes both EFFECTIVE and RETIRED with effectiveFrom <= asOf
  and effectiveTo > asOf (or null). Released report snapshots are never rewritten.
- UI exposes bilingual separate Approve and Activate actions only for eligible
  users and version states. This is layout approval, **not** sign-off of clinical
  reference values or actual printed/report delivery checks.
- Automated pure transition tests + MariaDB two-connection locking and
  interval history regression. The latter is wired explicitly into CI.

## Deliberate limitations / remaining gates
- No deferred or retroactive template scheduling is offered, because it would
  require additional immutable future version and revalidation semantics.
- The existing template identity/default-selection creation flow remains a
  separate surface; no historical code is modified by this package.
- §§75/86/87/88 and the 88 signed human/device/financial/DR UAT cases from
  Issue #250 remain OPEN. CI passing does not sign a clinical GO.
