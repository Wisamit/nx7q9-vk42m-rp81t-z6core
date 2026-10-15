# Stage 129 — Security, Audit, Encrypted Backup & Hostinger Resilience

Source base: owner-confirmed Stage 128 at main a16ae6b0c9d5f86ccd8d173b7b4e55702bea13f8, main CI #38696606040 SUCCESS. Master Scope §§2, 41, 63, 64, 77, 78, 79, 80, 83.

## Scope and limits

| Section | Evidence and changes | External acceptance not claimed |
| --- | --- | --- |
| §2 Branch/tenant | Existing branch+department session/tenant controls and new cross-tenant API-key/attachment race tests | Hostinger perimeter review |
| §41 Audit | Existing AuditEvent coverage; new ATTACHMENT_INTEGRITY_FAILURE log on corrupted document request | Human review of all audit trails |
| §63 Users/permissions | Server permission checks, MFA, sessions, API keys; new conditional revoked/expired/disabled key re-check | External authorization pentest |
| §64 E-signatures | Nine high-risk one-use step-up actions listed below; current action/session/resource/branch proof | Clinical and finance signatory acceptance |
| §77 Edge | Nonclinical events only; offline clinical writes disabled; Analyzer Bridge local spool retained separately | Edge failure and recovery drills |
| §78 Backup/DR | Private full MariaDB dump, compressed AES-256-GCM, SHA256 verify, opt-in immutable offsite transfer, restore import ONLY into brand-new isolated database | Actual Hostinger service setup, remote retrieval, timed physical restore |
| §79 Security | TLS/headers/least privilege/fail-closed attachment+integration authentication | Hostinger firewall/WAF/TLS/key rotation and real pentest |
| §80 History | Existing immutable clinical/financial reports; backup read only and recovery isolated | Historical comparison against real restored production data |
| §83 Attachments | Attachment metadata and binary content stored in MariaDB; size+SHA256 verified before authorized download, failure audited | Restored binary equality from real production backup |

## Explicit high-risk signature matrix

| Action | Permission | Resource-bound proof |
| --- | --- | --- |
| MEDICAL_APPROVAL | results.medical_validate | Medical result UUID |
| RESULT_RELEASE | results.release | Result UUID |
| RESULT_AMEND | results.amend | Original result UUID |
| REFUND_POST | billing.manage | Invoice:payment:amount:currency |
| CREDIT_NOTE_ISSUE | billing.manage | Invoice:amount |
| DISCOUNT_APPROVAL | billing.discount.approve | Pending request UUID |
| PATIENT_MERGE | patients.merge | Source:target patient UUID |
| CLINICAL_RULE_APPROVE | clinical_rules.approve | Exact clinical rule type/identity |
| CLINICAL_RULE_RETIRE | clinical_rules.approve | Exact clinical rule type/identity |

The reusable proof is granted only after password/TOTP verification and is consumed once in a transaction bound to session, actor, organization, branch, action and resource. Historical workflow evidence: Stages 96, 110, 120–123. This matrix is an engineering audit, NOT a medical signatory policy; other quality/security-sensitive actions have distinct controls and may require further owner policy before clinical GO.

## Backup workflow

- The operator-only command `npm run ops:backup` runs an entire database SQL dump from a private OS user using a temporary 0600 client configuration file. The password is NOT sent in CLI arguments. The pipeline compresses then AES-256-GCM encrypts streaming SQL, fsyncs a private archive, writes SHA-256 manifest, verifies authenticated decryption, then optionally uses `rclone copyto --immutable` for offsite.
- The current `attachment_contents` BLOB lives in MariaDB, so a full DB dump includes the actual attachment bytes. Analyzer Bridge spool, future external object stores and external vendor artifacts need separate backups; they are NOT implicitly covered.
- Missing offsite configuration fails closed by default. Local-only mode is an explicitly opted-in **test** mode (`FAMILY_LAB_BACKUP_ALLOW_LOCAL_ONLY=true`) and must not be enabled for production DR claims.
- `npm run ops:backup:verify -- <absolute-archive.flbak>` validates file/hash/authentication, not SQL recoverability.
- `npm run ops:restore-isolated -- <archive.flbak>` requires a new and nonexistent `family_lab_restore_*` DB, `FAMILY_LAB_RESTORE_EXPLICIT_ACK=ISOLATED_DATABASE_ONLY`, and verifies archive before importing; it never overwrites production and explicitly does not claim verified medical/financial history.
- The existing `/api/resilience/backups` API remains an evidence ledger, not a backup engine. VERIFIED requires independent restore evidence and duration, not just output from backup/verify.

## Automated coverage

Node mock encrypted archive, tampered ciphertext/wrong-key rejection, explicit local/offsite setting, empty/existing restore-target denial, attachment SHA/length guard, integration key revocation re-check, independent MariaDB sessions contending with revoke and tenancy, persisted BLOB equality. Existing wide CI validates migrations, TypeScript, ESLint, safety, all MariaDB integration tests, AR/EN/theme, and Next production build.

## Hostinger and Stage 132 dependencies

Still outstanding and NOT claimed: real backup scheduled and created, offsite remote credentials and its independent download/hash, database shell/dump and restore privileges, full physically restored scratch MariaDB and BLOB/report snapshots, review of secret rotation and production TLS/WAF/proxy trust, approved retention policies, RPO/RTO owner decision, DR timed drill, formal penetration/clinical/privacy signoff. Legacy Draft PRs #128 and #209 remain unmerged.
