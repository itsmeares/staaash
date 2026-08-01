# Storage Mutation Recovery

Staaash keeps human-readable logical paths canonical on local storage. Every
supported path-changing operation first records complete intent, affected
entities, fingerprints, and ordered filesystem steps in PostgreSQL. After intent
is `prepared`, recovery always rolls forward.

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
Unrelated owners remain available. Never manually move or delete a mutation's
incoming, backup, quarantine, staging, or canonical paths.

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
ambiguity.

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
