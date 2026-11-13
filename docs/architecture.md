# Architecture

Staaash is a modular monolith with a separate worker for background work. The
web app handles requests, and the worker handles durable work that must not
depend on a request staying open. Storage and recovery come first: the design
stays small until it has a reason to grow.

Guides for people running Staaash are in [`guide/`](guide/) and on the
[wiki](https://github.com/itsmeares/staaash/wiki). This page and the others in
`docs/` are for contributors.

## Parts

### Web app

- a Vite single-page app (TanStack Router and Query) served by a Hono server
  on Node; the server adds link-preview tags to share pages
- auth, files, sharing, search, restore, sync, and admin request flows
- public routes are described in `apps/web/openapi.json`; see [API](api.md)

### Worker

- cleanup, reconciliation, media derivatives, zip archives, and other queued
  work, visible in admin health
- one general job slot, one small-archive slot and one small-media slot per
  worker process, with separate lease owners and health records
- the small-archive slot accepts ZIPs of at most 32 directly selected files and
  8 MiB of source data, using metadata from the authorized selection
- folders and unknown sizes stay in the general slot; batch-move recovery keeps
  its own separate limit

All three job slots use the default database queue. The small-media slot accepts
thumbnail jobs, including existing queued jobs and retries, and finishes poster
jobs left by older releases without generating anything. Full video
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

The system of record for metadata: users, sessions, files and folders, shares,
the mutation journal, and other durable records.

### Storage volume

An app-managed local disk that holds original files in a readable layout. It
needs atomic rename within the volume and working file and directory `fsync`.

## Storage model

- PostgreSQL stores metadata, and the disk stores bytes.
- Logical paths are the same in metadata and on disk.
- Rename, move, trash and restore move real paths under a durable mutation
  journal in PostgreSQL.
- Uploads wait under `UPLOAD_LOCATION/tmp/` until their checksum is verified.

PostgreSQL holds the intent, and the filesystem holds the bytes. Prepared
mutations recover forward after a restart, except that a single user operation
rejected before any metadata commits (quota, overlong path, or exhausted
retries) is rolled back and aborted. How the journal works is in
[storage recovery](storage-recovery.md).

## Rules

These rules protect stored files and the promises Staaash makes. Change one only
with a reason that beats the one given.

1. Active originals live at `files/<storageId>/<logical hierarchy>`.
   Why: the disk stays readable without Staaash, and restore can compare paths
   with metadata.
2. Every rename, move, trash, restore and upload commit goes through the
   mutation journal.
   Why: a crash at any step leaves a state recovery can finish.
3. An ambiguous outcome keeps every possible byte and fails closed until an
   operator investigates.
   Why: guessing can destroy a file, and stopping only delays it.
4. Newly trashed roots use isolated readable paths below `.trash/<storageId>/`.
   Why: trashed bytes never collide with active files, and restore knows
   exactly what to put back.
5. Generated derivatives and archives stay below `derivatives/` and
   `archives/`.
   Why: they can always be rebuilt, so they never mix with originals.
6. Resumable uploads reserve bounded database capacity before staging, then
   verify the checksum and move the reservation to committed metadata
   atomically.
   Why: a half-finished upload never counts as a file and never breaks quota.
7. Share links bind to files or folders by stable IDs.
   Why: renaming or moving an item keeps its links working.
8. Search is case-insensitive, accent-insensitive, and path-token aware.
   Why: people search for a name the way they remember it.
9. Preview-capable media is viewed from original bytes; restore does not
   regenerate derivative previews.
   Why: a missing preview never blocks opening a file.
10. Thumbnails supply file lists and link-card pictures, follow the Thumbnails
    setting, and are queued after upload, when a single file is shared, or when
    a private list or a share page finds one missing. Smaller video copies
    follow their own setting and its upload, first-play and share triggers.
    Thumbnails and posters from older releases stay until their file is purged;
    only smaller video copies expire after the unused-copy retention days.
    Why: lists stay fast, and only the costly copies expire.
11. A link card offers a video only with a ready picture and either a ready web
    copy or an MP4 or WebM original below the web-copy threshold.
    Why: chat apps are never pointed at a large original.
12. Admin health includes database reachability, storage writability, worker
    heartbeat, queue backlog, disk warnings, and version or update status.
    Why: the owner sees a problem before members do.
13. Restore requires reconciliation instead of silent best effort.
    Why: a database and a files folder restored from different moments must not
    be trusted blindly.
14. Owner authority is operational. It is not a bypass into members' private
    files.
    Why: members trust the drive with private files.

### Stored names and totals

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
[resumable uploads](resumable-uploads.md#repairing-committed-usage).

## Desktop sync

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

## Limits

Not planned:

- a microservice split
- an S3-compatible storage backend
- collaboration permissions or shared workspaces

Not yet: a phone app. It is planned for later.

## Related docs

- [API](api.md): public routes, signing in, large folder changes, and health
  checks
- [Storage recovery](storage-recovery.md): the mutation journal, recovery, and
  upgrade cutover
- [Resumable uploads](resumable-uploads.md): upload admission, quota, and
  cleanup
- [Guides](guide/): install, back up, update, and run Staaash
