# Storage recovery

Staaash keeps human-readable logical paths canonical on local storage. Every
supported path-changing operation first records complete intent, affected
entities, fingerprints, and ordered filesystem steps in PostgreSQL. After intent
is `prepared`, recovery rolls forward, with one exception: a single user
operation that can never succeed is rolled back before metadata commit (see
[Pre-commit rejection](#pre-commit-rejection)).

This page is for contributors. Owners whose drive shows "Needs a storage
check" should read the [Storage Check guide](https://github.com/itsmeares/staaash/wiki/Storage-Check).

## Supported filesystem

Storage writes require a local, same-volume filesystem with atomic rename and
working file and directory `fsync`. Startup probes these capabilities. An
unsupported mount reports unhealthy and web storage writes return
`STORAGE_FILESYSTEM_UNSUPPORTED`. Network/object storage mounts are unsupported.
External access is browse or backup only; external edits are unsupported and
reported by reconciliation.

## Recovery behavior

The worker claims expired mutations with a new monotonic fence token and renews
a 30-second lease every 10 seconds. A stale executor cannot commit metadata.
Filesystem steps are idempotent:

- source present and target absent: validate fingerprint, then apply;
- source absent and valid target present: treat the step as already applied;
- a missing delete target: treat deletion as already applied;
- both paths, neither path when bytes are required, wrong type, or fingerprint
  mismatch: preserve all bytes and mark `recovery_required`.

Reads and writes for affected entities fail closed while recovery is active.
Unrelated owners remain available, and so do unrelated paths of the same owner. Never manually move or delete a mutation's
incoming, backup, quarantine, staging, or canonical paths.

## Large folder changes

A folder trash, restore, rename, move, or purge writes one journal entity and
one metadata operation for every file and folder inside it. When either list
is longer than 1,000, the journal prepares entities and applies descendant
metadata in chunks of at most 1,000:

- **Preparation.** The first transaction takes the locks and writes the
  mutation as `preparing`. Entities and their revision checks follow a chunk
  per transaction, then the namespace checks, and the last transaction marks
  it `prepared`. No executor runs a `preparing` mutation and nothing on disk
  has moved, so a failed preparation deletes its rows and locks. One left for
  60 seconds belongs to a request that stopped: worker recovery deletes it,
  and a retry with the same idempotency key starts over.
- **Commit.** After the disk steps, the operations for items inside the folder
  commit a chunk per transaction. `metadataOperationsApplied` moves in the
  same transaction as each chunk, so a retry resumes where the last attempt
  stopped. The folder's own change and any trash-entry removal commit last
  with the change feed. Creating a trash entry happens in the first chunk.
  From the first chunk on, the mutation only goes forward: it is
  never rolled back or aborted, because committed rows already point at the
  moved bytes.
- **Visibility.** Every item in the folder stays hidden behind its journal
  entity until the mutation finishes, so nobody reads a folder that is half
  moved. Sync refuses the whole snapshot while unfinished journal work affects
  its tree. Ancestor folder sizes can change between chunks.
- **Change feed.** It records one entry for the folder, which covers
  everything inside it, as it does for a small folder.

A folder change sent with `Prefer: respond-async` whose tree holds more than
2,000 files and folders answers `202` with a `FolderOperation` after its journal
is fully prepared. Invalid requests fail before acceptance. The web server
finishes accepted work in the background; worker recovery finishes it after a
restart. `GET /api/files/folders/operations/{id}` reads the saved journal and
reports `queued`, then `running` with the committed item count, then `succeeded`,
`failed`, or `recovery_required`. A retry validates the full request before
returning the same operation. Without the header, or for a smaller tree, the
request runs the change and answers `200` as before.

## Pre-commit rejection

Single user operations (folder create, file and folder rename, move, trash,
restore, and direct or resumable upload create and replace) end as `aborted`
instead of retrying when, before metadata commit:

- the commit-time quota check fails (`413 USER_STORAGE_QUOTA_EXCEEDED`);
- the filesystem reports `ENAMETOOLONG` (`400 STORAGE_PATH_TOO_LONG`);
- a transient failure persists for 11 attempts, about half an hour of backoff
  (`503 STORAGE_MUTATION_ABORTED`);
- on the first attempt, before any step is applied, a rename source no longer
  matches the fingerprint taken when the operation was planned
  (`409 STORAGE_ITEM_CHANGED`). The plan is fingerprinted before its locks are
  held, so an upload that finishes in between changes the tree. Nothing has
  moved, so the caller can try again. The same mismatch on a later attempt
  still becomes `recovery_required`.

The executor reverses forward steps newest first, with the same fingerprint
checks as forward renames, then releases the mutation's resources and frees
its idempotency key. A rename that landed on disk before it was recorded as
applied is reversed too. If the undo finds anything unexpected, the
mutation becomes `recovery_required` as before. Batch children, purges, and
worker artifact publishes never abort. Neither does a large folder change once
any of its metadata chunks has committed (see
[Large folder changes](#large-folder-changes)).

A single user operation or a batch move that was never claimed also ends as
`aborted` (`STORAGE_MUTATION_ABORTED`) once its claim has failed on a database
error 10 times and it is at least 5 minutes old. Nothing on disk has changed
at that point, so its paths and items are released. Waiting behind another
running operation does not count as a failure.

Direct uploads reserve their bytes when the mutation is prepared, so an
over-quota upload is rejected with 413 before any bytes move. Name components
over 255 UTF-8 bytes and paths over 4095 bytes are rejected before preparation.

## Resource ownership

Every operation owns the storage paths its steps touch. A path also covers
everything below it, so an operation inside a folder waits for a rename of that
folder, while operations elsewhere in the same account proceed. A batch move
owns the current and destination path of each selected item. Thumbnail and
preview publishes and purges also hold the original file they were built from.
Emptying the trash and trash retention own each trashed item they
will purge. An operation that names no path, a folder in the legacy trash
layout, and legacy recovery own the whole account. A `recovery_required` entry
keeps what it owns, so it blocks only those paths.

## Upgrade cutover

1. Stop old web and worker runtimes. Mixed storage protocols are unsupported.
2. Apply the database migration.
3. Start only the new worker.
4. The worker drains legacy pending-delete manifests, backfills legacy trash
   identity, removes obsolete lock files, scans transitional residue, and
   recovers journaled mutations.
5. Investigate any `recovery_required` entry. Unexplained residue is preserved.
6. After recovery and reconciliation, the worker writes storage protocol version 2. Web storage writes return maintenance 503 until that marker exists.
7. Start the web service.

Legacy trash restore and purge enumerate exact member paths. They never
recursively delete a shared legacy trash prefix.

## Operator actions

Admin health shows mutation ID, kind, owner, phase, oldest age, retrying count,
and recovery-required count. Correct transient database, permission, mount, or
space failures and let the worker retry. Admin retry is safe for transient
states. There is deliberately no automatic destructive resolution for
ambiguity, and no guided resolution yet either (#595).

Completed mutation path and fingerprint detail is redacted. Replay results stay
available for seven days; `recovery_required` records and their artifacts remain
until an operator resolves them with external evidence.

Run restore reconciliation only after journal recovery. It classifies current
originals, derivatives, archives, mutation-owned transition paths, unexplained
orphans, missing originals, and recovery-required mutations.

## Crash validation

The PostgreSQL integration suite exercises intent-only restart, filesystem
rename with a lost step commit, executor termination at that boundary, metadata
commit/finalization recovery, cleanup retry, expired-lease takeover, stale-fence
rejection, parent/child crash gaps, and the both-paths, neither-path,
wrong-type, checksum, and permission failure matrix. It also checks complete
tree metadata commits and preservation of untracked bytes. A real child-process
termination smoke test covers the rename boundary.

Windows does not provide a dependable chmod-based permission failure, so that
case is skipped locally and runs on Linux CI. Injecting a real host power loss,
kernel-level `fsync` failure, or PostgreSQL server crash is outside the
in-process suite; capability-probe failures and database prepare failures cover
the fail-closed paths, while deployment qualification should include mount and
database fault testing on the target platform.

## Transaction contention

Journal preparation tries quota and resource locks without waiting in a database
transaction. Preparation and metadata commits first join a per-account FIFO
queue in their process. Queue waiting is limited to 30 seconds; admission retries
then have a separate five-second window with jitter. At most 32 requests per
process may wait in the queue or between admission attempts. A cancelled ticket
does not let later requests skip an active predecessor. Other accounts can proceed
independently. Each retry uses the same
mutation ID, request hash and staged bytes. The database remains the ownership
authority across processes; the FIFO queue does not coordinate separate runtimes.
Sustained contention or a full queue returns `503
STORAGE_ADMISSION_BUSY` with `Retry-After: 1`.

Storage transactions use a separate Prisma pool with at most three connections
per process, so ordinary reads cannot consume their connections. This adds three
connections to the general pool's ten and the resumable-chunk pool's three.
Size PostgreSQL connection capacity for all web and worker processes.

The journal parent is awaited before its steps and resources, then its
entities, are inserted in the same transaction. This prevents nested child
writes from continuing after a parent transaction expires. Completion redacts
child details and releases resources after the fenced completion update. Any
command failure rolls back the transaction. Quota aggregation runs in one SQL statement under the
owner lock. Reservations, namespace checks, fencing and atomic publication are
unchanged.

Storage transactions have a five-second client ceiling. PostgreSQL 18 receives
transaction-local statement and full-transaction deadlines below that ceiling.
The five-second admission window bounds waiting and is checked again when the
transaction starts; it does not shorten an admitted transaction's work budget.
A successful attempt may therefore use up to five seconds to gain admission
after its queue turn, and another five seconds to finish its database work.
Prisma's exact refusal to start a transaction is retryable because its callback
never ran. Other transaction errors remain unavailable failures. The full-transaction
deadline ends the database session; it is not treated as a retryable lock refusal. Fallback lock
waits are limited to 100 ms. These settings do not change unrelated database
transactions or pool sessions.

A busy metadata commit retries only its database transaction while the existing
journal retains ownership. Its five-second admission window limits contention
retries, while each admitted attempt keeps the separate five-second transaction
ceiling. It does not repeat byte promotion or create a second upload. Other
failures leave the existing journal available to worker recovery.
Web logs retain the original preparation or execution error with the mutation
ID before returning a recovery response. Successful recovery clears the
journal's `lastError`, so use those logs to investigate a completed upload.
The browser shows **Finishing upload** after it has sent the bytes, and shows
completion only after the server confirms the save. Cancelling after all bytes
were sent stops waiting but cannot promise that an in-flight commit was undone.
Retry uses the original idempotency key to resolve that upload.
The expected replay result is stored with the prepared journal. If the worker
finishes the upload after the web request fails, it keeps that result so the
original key can still confirm the saved file. A prepared result is returned
only after the mutation succeeds.
This does not reconstruct replay results already lost by older versions.

Direct-upload staging cleanup is scheduled after saving without holding up the
success response. Scheduling failures are logged, and the worker's existing
periodic cleanup remains responsible for retention. A housekeeping failure does
not turn an already committed upload into a failed response.

An expired transaction or unknown commit result is not a blanket retry signal.
The node-postgres error for an already invalidated client is reported as
`503 STORAGE_TRANSACTION_UNAVAILABLE`, with the original error retained as its
cause. It is not an admission retry and does not receive a `Retry-After` header.
Web journal preparation has one narrower recovery attempt. If a fresh lookup on
the primary database confirms that no journal exists, preparation may retry once
with the same mutation ID, request hash, idempotency key and staged bytes. That
attempt has a fresh five-second admission window. A late commit cannot create a
second journal because the ID and key stay fixed. A prepared replay is claimed
atomically and keeps its original receipt. No filesystem step runs before
preparation succeeds. A failed lookup, running journal or second unavailable
attempt is not retried this way. Metadata commit and resumable-session creation
do not use this preparation retry.
Uncertain staging remains protected for recovery and retention cleanup. A proven
admission refusal or pre-prepare cancellation removes the request's unowned
staging. No schema migration is required for these changes.
