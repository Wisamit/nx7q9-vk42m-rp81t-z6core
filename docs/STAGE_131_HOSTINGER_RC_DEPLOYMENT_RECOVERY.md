# Family Lab — Stage 131 Hostinger Software RC Deployment and Safe Recovery Runbook

## Authority and boundaries
- Repo: `Wisamit/nx7q9-vk42m-rp81t-z6core`. Hostinger remains the sole intended deployment host. No Vercel.
- No production action is performed by GitHub CI or by this document. Deploy only the **independently green merge SHA on main** after owner-controlled backup evidence.
- This is a **software RC**. Clinical/financial/device, vendor, privacy, backup restore and security acceptance belong Stage 132. Do not record `GO` until independently approved.

## Before a Hostinger deployment
1. Confirm latest `main` SHA and completed **push CI success** on exactly that SHA, not only a successful PR CI on an earlier feature SHA.
2. Identify the actual deployment's `DATABASE_URL`, Node 22.18+, MariaDB connectivity, branch timezone and application secrets from secure Hostinger settings **without copying secret values to logs or GitHub**.
3. Take an owner-controlled database backup with `npm run ops:backup` from the intended private OS user, with offsite immutable target correctly configured. Never set `FAMILY_LAB_BACKUP_ALLOW_LOCAL_ONLY=true` in production. Verify archive SHA/authentication with `npm run ops:backup:verify -- <absolute-archive.flbak>`; crypto check is not SQL recoverability.
4. Where feasible, independently retrieve the archive and run `npm run ops:restore-isolated -- <archive.flbak>` into a brand-new `family_lab_restore_*` schema with `FAMILY_LAB_RESTORE_EXPLICIT_ACK=ISOLATED_DATABASE_ONLY`. Never specify the live schema. Validate count/identity, current report versions, historical values, one or more synthetic BLOB checksum checks under authorized access; record timed results.
5. Review pending Prisma migrations. **`npm run build` itself runs `prisma migrate deploy`**. Do not run it against a live schema without the backup and migration review above.

## Deployment sequence (owner-operated)
1. Checkout exact approved GitHub `main` SHA on Hostinger (avoid deploying latest floating HEAD without verification).
2. Use configured release environment; `npm install` then `npm run build` with intended database. The latter deploys migrations and regenerates Prisma, then builds Next.js.
3. Bring application online with the existing Hostinger Node process manager. Check application health, startup logs, database migration status and server-only secret presence **without exposing data**.
4. Record deployed SHA and timestamp. GitHub CI success alone is **not** proof of Hostinger success, instrument readiness, real email delivery or finance/clinical policy acceptance.

## Failed deployment or rollback
- If only application code/regression fails, stop the new process and restore previously known-good application release/commit with compatible database schema, without using `prisma migrate reset` or any destructive down migration.
- Stage 131 has **no new schema migration**; Stage 130 had an additive tenant-scoped payment posting index and nullable archival columns. Do **not** undo them when returning to an earlier code release; check compatibility first.
- If a migration/data-loss event is suspected: isolate affected traffic, preserve logs, do not run a second migration blindly, and escalate to formal restore from independently verified backup. The `ops:restore-isolated` utility intentionally **cannot overwrite production**. Production restore requires an approved, audited, separate DR runbook and authorized operators.
- Report corruption, cross-branch PHI exposure, inaccurate clinical result, misplaced specimen or inconsistent payment ledger is a **STOP/NO-GO** condition, never bypass with a UI workaround. Restore traffic only after cause/evidence review.

## Required Stage 132 signoffs
Clinical ranges, critical communication/readback, QC/Westgard, analyzer/bidirectional ACK, physical barcode chain of custody and printouts; patient/doctor/corporate permissions and consent; signed pricing/tax/payment/refunds/cashier counts; actual gateway receipts; offsite backup and timed restore RPO/RTO; Hostinger WAF/TLS/secret rotation, pentest; explicit owner + lab/finance/security GO/NO-GO.
