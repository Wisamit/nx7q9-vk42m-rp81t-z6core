# Issue #265 — governed reference, TAT and staff-access confirmation surfaces

## Live-code audit / scope
This increment follows the baseline 81-route source inventory and the shared
portal-based `CrudModal` from prior merged UI work. These four operating
surfaces still performed mutations through native browser prompts or direct
table-button requests:
- `ReferenceIntervalGovernanceActions`: clinical DRAFT approval, APPROVED retirement
- `TatEscalationAcknowledge`: escalation acknowledgement with optional note
- `UserManagement`: staff suspension and activation
- `RoleManagement`: non-system role deactivation and activation

The already-completed master-data editors, specimen workflows, quality forms,
clinical-rule step-up and catalog expert-review dialogs were not duplicated.

## Changes
- Every action opens a bilingual compact, centered `CrudModal`. Opening the
  dialog does not submit to the server. The operator sees the requested action
  and the relevant immutable identity and must explicitly submit a form.
- Reference retirement collects the existing mandatory reason. Clinical
  approval still relies on the unchanged server overlap, lifecycle and access
  checks. Previously released values are not updated.
- TAT escalation review captures its optional note but explicitly states that
  acknowledging a notification does not clear the actual delay or release
  laboratory results. The same endpoint is used.
- Staff and role status reviews show user/role identity, current and requested
  state; role review also discloses the current affected staff-account count.
  Protected system roles and last-admin restrictions remain server-enforced.
- Dialogs close only after success or explicit cancel. Duplicate submissions
  are guarded by an `inFlight` ref and disabled controls. Failed requests,
  stale local status and interrupted connections keep useful bilingual
  messages without pretending an action was committed.
- Shared keyboard/focus restore, RTL/LTR, unsaved/discard safeguards, compact
  mobile layout and theme tokens remain centralized in `CrudModal`.
  No server workflow, tenant permission, tax, report, specimen or patient schema
  was changed. There are no migrations.

## Automated evidence and honest limitations
- New source regression:
  `tests/ui-governed-status-reference-tat-dialogs.test.ts`.
- Existing `ui-existing-admin-compact-dialogs` count updated to include the
  added staff status dialog; no accessibility requirements or routes removed.
- Final engineering CI must run on exact feature HEAD and independently again
  on the merge commit before reporting a deployable SHA.
- Static component tests are **not** a rendered browser walkthrough, and the
  full 81 x 6 private synthetic browser scenario matrix is **NOT_EXECUTED**.
  User/owner acceptance, screen-reader/mobile visual checks, role-by-branch
  interactive checks and actual Hostinger publication remain separate.

## Release status
Issue #265 **OPEN**. Full-route visual/keyboard/theme/date/RTL acceptance still
requires isolated PRIVATE synthetic staging and protected evidence.
Issue #250 **OPEN / NO_GO**; qualified medical, finance, device, security,
Hostinger restore and owner acceptance cannot be inferred from software CI.
No real patient/clinical rows, credentials or private screenshots were used.
