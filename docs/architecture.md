# Architecture

## System Shape

Staaash is a modular monolith with a separate worker runtime for background behavior.

The web app handles the interactive product surface, request-time business logic, and owner-facing operational views. The worker handles durable background work that should not depend on a request staying open.

This is intentionally a small, explicit architecture. The repo is trying to make storage and recovery behavior reliable before it tries to look more distributed than it needs to be.

## Main Runtimes

### Web app

- Next.js App Router application
- signed-in workspace shell and server routes
- auth, files, sharing, search, restore, and admin-facing request flows

### Worker

- separate runtime for background behavior
- intended home for cleanup, reconciliation, and other queued work
- operationally visible through admin health surfaces
- one general job slot and one small-archive slot per worker process, with
  separate lease owners and health records
- the small-archive slot accepts ZIPs of at most 32 directly selected files and
  8 MiB of source data, using metadata from the authorized selection
- folders and unknown sizes stay in the general slot; batch-move recovery keeps
  its existing separate limit

Both job slots use the default database queue. Small archives have priority 1
and the general slot excludes those marked ZIP jobs. Older workers still drain
the same queue after a rollback. Already queued jobs without the marker keep
their original general-slot behavior. Retry preserves the marker. Source bytes
are measured at enqueue time, so these limits bound the known selection, not
execution time. Each slot has one notification connection and keeps polling as
a fallback. The process starts the periodic scheduler and move recovery once.

### PostgreSQL

- system of record for metadata
- stores users, auth/session state, file and folder metadata, sharing state, and other durable app records

### File storage volume

- app-managed local disk
- stores original binaries in a human-readable canonical logical layout
- requires local same-volume atomic rename plus working file and directory fsync

## Core Data And Storage Model

- PostgreSQL stores metadata
- physical files live on an app-managed local volume
- logical paths are canonical in metadata and on disk
- rename, move, trash, and restore physically move paths under a durable
  PostgreSQL mutation journal
- uploads stage under `UPLOAD_LOCATION/tmp/` before verification and commit

PostgreSQL is the durable intent authority while the filesystem is the canonical
byte store. Prepared mutations recover forward after restart, except that a
single user operation rejected before metadata commit (quota, overlong path, or
exhausted retries) is rolled back and aborted. Ambiguous outcomes preserve every
possible byte and fail closed until an operator investigates.

## Locked Behavior Rules

- active originals use `files/<storageId>/<logical hierarchy>`
- newly trashed roots use isolated readable paths below `.trash/<storageId>/`
- generated derivatives and archives stay below `derivatives/` and `archives/`
- resumable uploads reserve bounded database capacity before staging, then
  verify checksum and transfer the reservation to committed metadata atomically
- share links bind to files or folders by stable IDs
- search is case-insensitive, accent-insensitive, and path-token aware
- `/admin` health includes DB reachability, storage writability, worker heartbeat, queue backlog, disk warnings, and version or update status
- restore requires reconciliation instead of silent best effort
- preview-capable media is viewed from original bytes; restore does not regenerate derivative previews

Search name candidates use `File.searchName`, derived with the same PostgreSQL
normalization as the name query. A database trigger updates it in the same
transaction as inserts and name changes, including journal and worker writes.
The trigram index covers active, available files. Folder paths remain computed
from current metadata, so moving a folder does not rewrite descendant search
names. Changing the normalization rules requires backfilling the stored values.
The initial migration backfills names and builds the index under an exclusive
`File` table lock. Startup waits for that migration before serving requests.

`User.committedStorageBytes` counts all retained file rows, including trash and
missing originals. Statement triggers apply size and owner changes atomically,
once per affected owner in ID order. Name-only and status-only changes do not
update the owner row. Upload and journal reservations remain separate and keep
their existing expiry and staging-release rules. The initial migration locks
users and files while it backfills and verifies totals.

Web and worker startup, and restore reconciliation, compare stored usage with
file metadata. A mismatch sets affected totals to NULL and stops startup or the
audit. NULL blocks quota admission and file growth until an operator rebuilds
usage with all writers stopped. See the repair procedure in
[`resumable uploads`](operations/resumable-uploads.md#repairing-committed-usage).

## Boundaries And Non-Goals

- no microservice split in v1
- no desktop sync client in v1
- no native mobile app in v1
- no S3-compatible storage backend in v1
- no internal collaboration permissions or shared workspaces in v1
- owner authority is operational, not a normal-app superuser bypass for member private content

## Related Docs

- [`../.github/README.md`](../.github/README.md) for install and local development steps
- [`operations/backup-restore.md`](./operations/backup-restore.md) for backup and restore expectations
- [`operations/resumable-uploads.md`](./operations/resumable-uploads.md) for resumable admission, quota, and cleanup behavior
- [`operations/storage-mutation-recovery.md`](./operations/storage-mutation-recovery.md) for mutation recovery and upgrade operations
