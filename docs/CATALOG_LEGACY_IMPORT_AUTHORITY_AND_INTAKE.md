# Legacy catalog intake and transaction-time safe-master authorization

## Reproduced source-level gaps

The legacy JSON import route used unbounded request.json() before the 20,000-row
limit; it accepted uncontrolled source filenames. The safe-master commit
serialized writes under an organization lock and reread the latest import
batch, but relied on SESSION branch grants after the lock and did not
reconfirm the actor's live role/permission, nor detect revoked restricted
department grants. A concurrent role or branch revocation could therefore
leave a stale request capable of creating master definitions.

## Implemented controls

- Preserve existing catalog.manage session gateway, then after the tenant
  lock read the current ACTIVE actor, same-tenant ACTIVE role permission and
  exact ACTIVE branch grant; intersect with the session branch assignment.
- Require ACTIVE organization on the existing lock. If a session was
  department-restricted, revoking every effective grant cannot expand the
  clinical import scope to the entire organization. No destination department
  is guessed for imported test records.
- Reject before the batch is marked IMPORTED and before any unit, container,
  lab test or panel writes. Unauthorized attempts leave the batch unchanged
  and do not produce a successful commit audit.
- Count all five deferred classes uniformly before/after locking, including
  commercial packages and package tariffs. Persist the latest locked batch
  summary, not an earlier snapshot.
- Limit cleaned legacy catalog JSON to 32 MiB measured from the body stream
  (Content-Length is advisory). Enforce UTF-8 and JSON parsing, media type
  and a bounded source name without control characters. Original normalization,
  validation and 20k-row cap remain.
- Pure safety tests and two-connection MariaDB tests guard the actual read
  entitlement, scope revocation, transaction ordering and unmodified rejected
  batch; full CI also includes integration and production Next build.

## Explicit release limits

This is not full row-level parity against the real cleaned Access MDB.
The software still does not authorize direct activation of spreadsheet or
signed bundle candidates, unreviewed reference intervals or pricing.
Owner/clinical/finance UAT and physical analyzer/backup rehearsals remain
NO_GO under Issue #250; full private rendered-UI acceptance is still
NOT_EXECUTED under Issue #265. No real patient or MDB data is committed.
