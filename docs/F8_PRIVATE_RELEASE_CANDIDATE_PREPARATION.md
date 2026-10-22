# F8 — private release-candidate template preparation

## Purpose and historical integrity

The original Stage 132 UAT cases file is a historical Stage 131 release
baseline. It contains 88 sections but refers to an older software commit.
Do not overwrite this historical file with an assumed current or deployed SHA.

New script: scripts/operations/f8-private-release-candidate.mjs.
It prepares a separate PRIVATE candidate containing all 88 original sections,
seven qualified acceptance gates and NOT_EXECUTED states.

## Final consolidated UAT only

After an independently SUCCESSFUL GitHub main CI and separately verified
Hostinger deployment, prepare a candidate with:

    node scripts/operations/f8-private-release-candidate.mjs --sha EXACT_40_HEX_MAIN_SHA --out /private/familylab/f8-candidate.json

The destination must be absolute, outside the public repository and inside
an already-existing protected private directory. The script creates the file
exclusively (no overwrite), mode 0600 on POSIX systems.

The command does NOT connect to GitHub, Hostinger, hardware, backups or
clinical services and cannot certify the SHA it was given. It records
ownerConfirmedDeployment = NOT_VERIFIED, stageStatus = NOT_EXECUTED, and all
88 sections remain NOT_EXECUTED.

Existing metadata validation remains unchanged by default. A prepared private
candidate can instead be selected explicitly:

    node scripts/operations/stage132-acceptance-gate.mjs --check-template --template /private/familylab/f8-candidate.json
    node scripts/operations/stage132-acceptance-gate.mjs --assess /private/familylab/evidence.json --template /private/familylab/f8-candidate.json

Assessment fails closed if deployment remains NOT_VERIFIED. Only qualified
owner/operators may subsequently supply independently corroborated deployment
and case evidence. The assessor, even for structurally complete evidence,
never grants medical, accounting, device, regulatory or operational GO.

## Gate status

- F7 owner browser/UX acceptance: UAT_DEFERRED / NOT_EXECUTED.
- 81 routes times 6 visual contexts = 486 captures remain NOT_EXECUTED.
- F8 88 qualified cases and seven gate signoffs: NOT_EXECUTED / NO_GO.
- Hostinger SHA, actual offsite recovery, devices and critical clinical
  configurations: NOT VERIFIED by this preparation.
- Master Scope sections 1–88: retained without reduction.

This is software preparation for one final owner-operated review, not a
request for intermediate manual testing.

## Independent post-merge main CI engineering gate

This increment also adds a merged pull-request `closed` event to
`.github/workflows/ci.yml`, in addition to the pre-existing push/main and
regular PR triggers. GitHub App-authored merges may not create an automatic
push-triggered Actions run, so a successful feature-branch CI alone can leave
the corresponding `main` SHA without an independent validated run.

A merged-closed run checks out `pull_request.merge_commit_sha` explicitly,
verifies the checkout revision equals that SHA, requires the base branch to be
`main`, then runs the **same** migration, MariaDB, safety, TypeScript,
ESLint, i18n and Next production build. Closed-but-unmerged pull requests
do not execute `validate`.

The normal push/main CI still runs where GitHub emits it. Either independent
post-merge CI path counts only after the finished run is SUCCESS **on the exact
merged main SHA**. No older main or feature SHA can be substituted. Merges
still require an exact successful feature-head CI first.

PR #352's existing merged SHA `bd8e5c9e1ac98c7675783457177b4445e355efbe`
had no separately observed push-main CI run when this gate was prepared.
This change is **prospective**, not proof that PR #352 previously passed
its independent main gate. It can check the combined source at the next
merge without rewriting clinical history or making a fake historical claim.
