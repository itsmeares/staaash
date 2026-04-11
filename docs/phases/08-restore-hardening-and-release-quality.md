# Phase 08: Restore, Hardening, and Release Quality

## Approach

Use the final phase to enforce the product’s trust promises through reconciliation, recovery visibility, and serious verification coverage.

## Scope

- In:
  - restore reconciliation
  - integrity checks between DB metadata and originals
  - original-byte preview compatibility verification
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

- [x] Implement the restore reconciliation job and reporting model.
- [x] Detect missing originals and orphaned storage keys.
- [x] Keep preview behavior on original-byte viewing and verify compatibility routes after restore.
- [x] Add integration coverage for auth, uploads, library, sharing, search, admin, and restore health wiring.
- [x] Add a selective Playwright smoke harness for the highest-risk user journeys.
- [x] Refresh install, backup, restore, and upgrade documentation for the finished v1 behavior.

## Validation

- Verify a known restore scenario end-to-end.
- Verify orphan and missing-file issues are visible to the owner.
- Verify preview-capable private and public routes still render from original bytes.
- Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, and `pnpm web:e2e`.

## Done Criteria

- The product can credibly claim serious-release quality.
- Recovery behavior is observable, documented, and tested.
