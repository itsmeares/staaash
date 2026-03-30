# Phase 03: Upload Pipeline and File Operations

## Approach

Implement the upload path as a trustworthy pipeline: staged first, verified second, committed last.

## Scope

- In:
  - staged uploads
  - checksum verification
  - atomic commit
  - file-size limits
  - file rename/move/trash/restore/delete
  - staging cleanup job wiring
- Out:
  - resumable uploads
  - chunked uploads
  - deduplication
  - quotas

## Dependencies

- Phase 02 complete

## Action Items

- [ ] Implement the upload route and server flow using staging under `FILES_ROOT/tmp/`.
- [ ] Enforce the upload size limit and timeout contract from env/config.
- [ ] Verify uploads with checksum before commit and persist committed checksum metadata.
- [ ] Implement conflict behavior by surface: prompt for interactive UI, safe-rename for non-interactive flows.
- [ ] Implement file move, rename, trash, restore, and permanent delete behavior.
- [ ] Add worker-enqueued cleanup for abandoned staging files older than TTL.
- [ ] Add tests for checksum mismatch, atomic commit, conflict behavior, and staging cleanup eligibility.

## Validation

- Verify no committed file exists before verification succeeds.
- Verify silent overwrite never occurs by default.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Done Criteria

- Uploading files is reliable enough to be a serious product workflow.
- File operations preserve the immutable physical storage model.
