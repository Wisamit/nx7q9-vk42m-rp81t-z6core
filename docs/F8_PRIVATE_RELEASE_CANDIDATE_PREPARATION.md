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
