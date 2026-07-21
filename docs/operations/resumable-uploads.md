# Resumable Upload Capacity and Cleanup

Resumable uploads reserve database-authoritative capacity before Staaash creates
their staging file. This keeps concurrent admissions within user quota, session,
staged-byte, and physical disk-headroom limits.

## Default limits

The owner can change these values under **Admin > Settings > Uploads**:

| Setting                       | Default | Meaning                                                                   |
| ----------------------------- | ------: | ------------------------------------------------------------------------- |
| Active sessions per user      |       4 | Concurrent active resumable sessions owned by one user                    |
| Active sessions instance-wide |      32 | Concurrent active resumable sessions across the instance                  |
| Staged bytes per user         |  20 GiB | Active reservations plus unreleased staging liability for one user        |
| Staged bytes instance-wide    | 100 GiB | Active reservations plus unreleased staging liability across the instance |

The per-user staged-byte limit must allow one maximum-size upload. The instance
session and staged-byte limits must be at least their per-user equivalents.
Staaash also requires projected free disk space to remain at least 10% of the
storage filesystem after admitted resumable uploads reach their requested size.

Active resumable reservations count with committed files against a user's
storage quota. A reservation admitted before a quota or limit reduction may
finish, but new sessions use the reduced value immediately. Ordinary uploads
join the same per-user quota lock when committed metadata grows.

## Lifecycle and retention

- A new database row starts as `allocating` with a 10-minute allocation lease.
- An empty staging file is then created; Staaash does not preallocate the full
  requested file size.
- Successful allocation changes the session to `created` with a 24-hour expiry.
- Completion transfers the active reservation to committed file usage in one
  database transaction.
- Cancellation, checksum failure, allocation failure, and expiry become terminal
  before filesystem cleanup starts.
- Terminal chunks are deleted promptly. Lightweight terminal parent rows remain
  for 24 hours, then the staging-cleanup worker deletes them.

`stagingReleasedAt` is the release authority. Until it is set, the session's full
requested size continues to count against staged-byte limits. It is set only
after staging-file absence has been confirmed. Missing files are safe and count
as successful idempotent cleanup.

## Cleanup backpressure

One cleanup failure or overdue parent row does not disable resumable uploads.
An unreleased staging file consumes its normal user and instance staged-byte
capacity; it rejects new work only when that capacity or disk headroom is
actually exhausted.

Released parent rows consume no staging capacity. To prevent unbounded database
growth during systemic database-cleanup failure, admissions stop only when the
terminal/pending-cleanup backlog reaches:

- per user: `active sessions per user × 96`
- instance-wide: `active sessions instance-wide × 96`

The factor 96 is one full 24-hour retention period at the 15-minute cleanup
cadence. Admissions resume automatically after cleanup lowers the backlog.

## Operations and recovery

Cleanup is idempotent and runs every 15 minutes. Individual failures are stored
on `UploadSession.cleanupAttemptCount`, `cleanupLastAttemptAt`, and
`cleanupLastError`. The worker also records a `cleanup_warning` job event and
logs the affected session IDs. A failed periodic job is retried; after its retry
budget is exhausted, the next periodic run is still scheduled.

For persistent failures:

1. Inspect the latest `staging.cleanup` job events and worker logs.
2. Correct storage permissions, mount availability, or PostgreSQL availability.
3. Let the next scheduled cleanup retry. Missing staging files and already
   deleted rows are handled safely.
4. If admission is backpressured, verify unreleased staged-byte totals and the
   terminal-row backlog before manually deleting anything.

Do not manually set `stagingReleasedAt` while a staging file may still exist.
Doing so would remove its capacity liability before physical deletion.

## Upgrade ordering

This schema change and the new web lifecycle must be deployed together. For a
self-hosted upgrade, stop the old web process, apply migrations, then start the
new web and worker versions. The new web can run briefly with an older worker;
capacity remains bounded and cleanup waits. Do not run the older web version
against the migrated schema: it neither participates in admission locking nor
sets the required terminal lifecycle fields.

Application rollback alone is therefore unsafe after this migration. Prefer a
forward fix. A full rollback requires restoring the matching pre-upgrade
database backup and application version together.

The migration preserves unexpired active sessions and immediately counts them
under the new limits. Existing expired sessions become `expired`; existing
terminal chunks are removed. Completed sessions are treated as already released,
while failed or cancelled sessions remain staging liabilities until the worker
confirms file absence. An over-limit active session may still finish, but new
admissions wait for capacity.
