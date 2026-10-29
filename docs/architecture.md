# Architecture

## System Shape

Staaash is a modular monolith with a separate worker runtime for background behavior.

The web app handles the interactive product surface, request-time business logic, and owner-facing operational views. The worker handles durable background work that should not depend on a request staying open.

This is intentionally a small, explicit architecture. The repo is trying to make storage and recovery behavior reliable before it tries to look more distributed than it needs to be.

## Main Runtimes

### Web app

- a Vite single-page app (TanStack Router and Query) served by a Hono server
  on Node; the server adds link-preview tags to share pages
- auth, files, sharing, search, restore, sync, and admin-facing request flows
- public routes are described in `apps/web/openapi.json`; within a major
  version they only gain routes and fields, and `GET /api/version` reports the
  oldest desktop client the server supports

### Worker

- separate runtime for background behavior
- intended home for cleanup, reconciliation, and other queued work
- operationally visible through admin health surfaces
- one general job slot, one small-archive slot and one small-media slot per
  worker process, with separate lease owners and health records
- the small-archive slot accepts ZIPs of at most 32 directly selected files and
  8 MiB of source data, using metadata from the authorized selection
- folders and unknown sizes stay in the general slot; batch-move recovery keeps
  its existing separate limit

All three job slots use the default database queue. The small-media slot accepts
thumbnail and poster jobs, including existing queued jobs and retries. Full video
previews and unknown payload kinds stay in the general slot. Payload validation
rejects unsupported media kinds before starting a handler. Media decoders, filters
and encoders use one thread each. Probes have a one-minute limit and individual
frame captures have a two-minute limit. Cancellation reaches input and output
probes as well as encoding, and a child that ignores termination is killed after
five seconds. Full conversions retain their six-hour job limit. Before publishing
generated output, the worker uses the existing bounded storage-admission wait
for brief resource conflicts. Accepted journal work keeps control of its bytes
and recovery; a job does not rebuild an artifact merely because another save
briefly owns the account lock. Archive selection also waits through brief source
locks and reloads its metadata before reading bytes. Persistent locks still stop
the archive, and cancellation stops the wait.

Small archives have priority 1
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

`Folder.treeSizeBytes` holds the complete size of active files below an active
folder, including nested folders and missing originals. File and folder statement
triggers update it in the metadata transaction, so the web app, worker, and
journal recovery share one rule. File and folder writes take the same exclusive
hierarchy lock before row locks. This serializes metadata changes across accounts
and avoids lock upgrades in transactions that write files before folders. Folder
moves and deletion changes update affected folders and ancestors from their saved
totals. Restored folders and existing cycles read their direct live files when the
old total cannot supply that contribution. Unchanged branches use their saved
totals. Reads use the stored value. The migration locks folders and files
while it backfills totals. Restore reconciliation rebuilds these display totals
after the committed-usage audit succeeds. Display totals do not control quota.

`User.committedStorageBytes` counts all retained file rows, including trash and
missing originals. Statement triggers apply size and owner changes atomically,
once per affected owner in ID order. Name-only and status-only changes do not
update the owner row. Upload and journal reservations remain separate and keep
their existing expiry and staging-release rules. The initial migration locks
users and files while it backfills and verifies totals.

Web and worker startup, and restore reconciliation, compare stored usage with
file metadata. A mismatch sets affected totals to NULL. A startup audit failure
blocks service for the entire instance, even if only one account is affected:
the worker exits, and the web process fails server preparation and returns 500.
A restore audit failure stops reconciliation. This policy stops startup before
recovery can change files while accounting is inconsistent. NULL also blocks
quota admission and file growth in an already running process. An operator must
investigate and rebuild usage with all writers stopped. See the repair procedure in
[`resumable uploads`](operations/resumable-uploads.md#repairing-committed-usage).

## Desktop Sync

- a desktop app signs in through the browser: a loopback redirect with PKCE
  gives it a device token, sent as a Bearer header; device tokens cannot reach
  admin routes, and signing the device out also ends its app window session
- every journal commit appends one `StorageChange` per top-level item in the
  same transaction; a folder entry covers what moved with it
- `seq` order is commit order: writers hold one advisory lock until commit, so
  a client that has read up to a cursor never misses an earlier change
- the log keeps 90 days; an older cursor or one ahead after restore gets 410,
  and the client takes a new snapshot
- `ifRevision` on rename, move, trash, and upload commit refuses a change to an
  item that moved on, and every journal update bumps `storageRevision` by one
- keeping the device's copy after a conflict is one journal entry: the file
  keeps its id, and its old bytes go to the trash

The desktop app (`apps/desktop`) syncs pairs: one local folder with one server
folder, two-way, download only, or upload only. Pairs never overlap.

- it decides each path from three states: the computer, the server, and the
  last state both agreed on. Content changes are compared by SHA-256, so a
  revision bump from a parent's rename is not a conflict
- a file changed on both sides is never merged or overwritten: the local
  version is renamed to `name (conflict, <device>, <time>).ext` and both sync
- deletes go to the trash on both sides, and an edit beats a delete;
  upload-only pairs work like a backup and never delete on the server
- downloads land in a temporary file beside the target, are checked against
  the server's checksum, and replace the file in one rename
- if a pair's local folder is missing, or every file of a big pair vanishes on
  one side, that pair stops until the person says what they meant
- only a path that is confirmed gone counts as deleted. Ignored names, links,
  names the computer cannot hold, and anything that could not be read are
  left alone on both sides, and a folder holding one is never trashed
- the sync history is saved after each file or server change, so a stop in
  between leaves both sides changed and the history behind; the next run
  finds both sides equal and records them without moving bytes
- passes, conflict choices, and forgetting removed pairs run one at a time in
  the order asked. A settings change or a stop takes effect before the next
  action, and stopping aborts transfers, which resume on the next run

## Boundaries And Non-Goals

- no microservice split in v1
- no native mobile app in v1
- no S3-compatible storage backend in v1
- no internal collaboration permissions or shared workspaces in v1
- owner authority is operational, not a normal-app superuser bypass for member private content

## Related Docs

- [`../.github/README.md`](../.github/README.md) for install and local development steps
- [`operations/backup-restore.md`](./operations/backup-restore.md) for backup and restore expectations
- [`operations/resumable-uploads.md`](./operations/resumable-uploads.md) for resumable admission, quota, and cleanup behavior
- [`operations/storage-mutation-recovery.md`](./operations/storage-mutation-recovery.md) for mutation recovery and upgrade operations
