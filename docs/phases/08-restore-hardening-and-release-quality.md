# Phase 08: Restore, Hardening, and Release Quality

## Approach

Use the final phase to enforce the product’s trust promises through reconciliation, recovery visibility, and serious verification coverage.

## Scope

- In:
  - restore reconciliation
  - integrity checks between DB metadata and originals
  - preview regeneration scheduling
  - orphan reporting
  - integration tests
  - selective E2E tests
  - final docs polish
- Out:
  - aggressive auto-repair
  - best-effort restore ambiguity

## Dependencies

- Phases 01 through 07 complete enough for realistic end-to-end verification

## Action Items

- [ ] Implement the restore reconciliation job and reporting model.
- [ ] Detect missing originals and orphaned storage keys.
- [ ] Schedule preview regeneration after restore when needed.
- [ ] Add integration coverage for auth, uploads, library, sharing, search, and admin.
- [ ] Add selective E2E coverage for the highest-risk user journeys.
- [ ] Refresh install, backup, restore, and upgrade documentation for the finished v1 behavior.

## Validation

- Verify a known restore scenario end-to-end.
- Verify orphan and missing-file issues are visible to the owner.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Done Criteria

- The product can credibly claim serious-release quality.
- Recovery behavior is observable, documented, and tested.
