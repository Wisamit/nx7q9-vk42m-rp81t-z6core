# Family Lab LIS — Operations & Disaster Recovery Runbook

## Purpose

This runbook defines the minimum operational recovery procedure for Family Lab LIS. It complements infrastructure-specific procedures from the database, object-storage and hosting providers. It does not replace provider backup configuration.

## Safety invariants

- Never restore a backup over production before its integrity and timestamp are verified.
- Never delete or rewrite released clinical results, diagnostic report versions or audit history as part of retention cleanup.
- Never enable offline clinical writes through the branch continuity controls. The supported edge mode buffers only explicitly whitelisted non-clinical operational events.
- Never treat a successful backup job as a successful recovery until a restore test has been completed.
- Preserve organization and branch boundaries during every recovery or replay operation.

## Health checks

- `GET /api/health/live` confirms that the application process is alive.
- `GET /api/health/ready` confirms database reachability and returns HTTP 503 when the application is not ready.
- Load balancers and deployment platforms should use readiness for traffic admission.
- Health endpoints intentionally expose minimal operational information.

## Backup policy

The production deployment must configure automatic backups outside the web application.

Minimum target:
- database backups: daily or more frequently according to business RPO;
- uploaded/file/object assets: backed up on a matching schedule;
- offsite copy: enabled;
- retention: daily, weekly and monthly generations according to organization policy;
- encryption and access control: supplied by the selected backup/storage provider.

The Resilience workspace records backup and restore evidence. A record in the LIS is evidence metadata only; it does not prove that an external backup exists unless the referenced provider artifact is independently verified.

## Backup verification

For each verification cycle:

1. Select a backup artifact that is not the live production database.
2. Verify provider status, creation time, size/checksum when the provider exposes them, and retention class.
3. Restore into an isolated recovery environment.
4. Apply no new migrations until the restored schema/version is documented.
5. Verify login, organization/branch structure, patient lookup, order lookup, specimen traceability, released report history and audit records.
6. Record restore duration and evidence in the Resilience workspace.
7. Mark the backup VERIFIED only after a successful restore test.

## Disaster recovery drill

Each drill must define:

- target RPO in minutes;
- target RTO in minutes;
- recovery scope: organization or branch;
- scheduled time and owner;
- actual RPO and RTO;
- evidence reference;
- findings and corrective actions.

A PASSED or FAILED drill must record actual RPO/RTO and completion time.

## Database recovery

1. Declare the incident and stop writes if continued writes could worsen data integrity.
2. Identify the last verified backup compatible with the intended recovery point.
3. Preserve the failed database or snapshot for investigation when possible.
4. Restore into an isolated database first.
5. Run `npx prisma migrate status`.
6. Compare the restored migration history with the application release being deployed.
7. Run `npx prisma migrate deploy` only after the restored database state is understood.
8. Run application readiness checks and a clinical-history smoke test.
9. Switch application traffic only after approval.
10. Record actual RPO/RTO and incident evidence in the DR drill/quality process.

Do not use `prisma migrate resolve` as a routine recovery shortcut. It is only appropriate when the exact migration state is known and documented.

## File/object recovery

Restore attachments and report assets from the backup generation aligned with the database recovery point. Validate access controls after restoration. Do not expose storage buckets publicly as a recovery workaround.

## High availability

The application is designed to support deployment behind redundant application instances and managed database/storage services, but high availability is an infrastructure property and must not be claimed solely from application code.

Production HA planning should address:

- multiple application instances where required;
- database replication/failover appropriate to the provider;
- redundant object storage;
- load-balancer health checks;
- secret/configuration availability;
- monitoring and alerting;
- tested failover and rollback procedures.

## Branch continuity and edge buffering

Continuity modes:

- `CENTRAL_ONLY`: normal central operation.
- `READ_ONLY_CACHE`: architecture reservation for controlled cached access.
- `BUFFER_NON_CLINICAL`: permits registered edge nodes to synchronize only whitelisted non-clinical operational events.

Current edge intake accepts only:
- `QUEUE_TICKET_EVENT`
- `APPOINTMENT_CHECKIN`
- `EQUIPMENT_HEARTBEAT`
- `EDGE_HEALTH_EVENT`

Edge batches require a scoped integration API key with `edge.sync`, are idempotent, and are staged without mutating clinical records.

Clinical ordering, specimen custody, result entry, verification, release, amendment and billing writes must not be accepted as offline edge events.

## Dead-letter recovery

Review dead-letter counts for analyzer, integration, webhook and edge queues before replay.

- Confirm the destination/configuration problem is corrected.
- Prefer idempotent replay.
- Never replay an integration event in a way that creates a second released result or report version.
- Preserve original raw payload/log records.
- Record meaningful corrective actions when repeated failures indicate a quality incident.

## Retention and archive

Protected classes:
- clinical results;
- diagnostic reports;
- audit events.

These are forced to `RETAIN_ONLY` by the application.

In-app destructive purge is limited to expired/revoked user and portal authentication sessions and requires an explicit confirmation. Technical messages configured for ARCHIVE must be exported to an approved archive target before any future removal mechanism is introduced.

## Deployment and migration validation

CI must deploy the complete migration chain against a clean MariaDB instance before TypeScript and lint validation. Production deployment still runs `prisma migrate deploy` before the application build.

If a migration fails in production:

1. stop repeated automated retries if they can worsen a partial DDL state;
2. inspect the exact failed statement and `_prisma_migrations`;
3. inspect which DDL statements already committed;
4. repair only after the actual database state is known;
5. preserve existing clinical/financial data;
6. validate on an isolated database before redeployment.

## Minimum post-recovery smoke test

Verify:

- application readiness returns ready;
- authenticated login succeeds;
- branch scope is correct;
- patient search works;
- order and invoice history are readable;
- specimen barcode/chain of custody is readable;
- released report versions are intact;
- critical-result and QC history are readable;
- audit history is available;
- integration/edge queues do not contain unexpected duplicate processing.

Document the recovery outcome and any required CAPA/nonconformance record.
