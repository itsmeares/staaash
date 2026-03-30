# Phase 02: App Shell and Library Core

## Approach

Build the signed-in app shell and private drive navigation before file ingestion so the user’s core mental model is stable.

## Scope

- In:
  - signed-in shell
  - left sidebar and top bar
  - `/admin` separation
  - `Library`, `Recent`, `Favorites`, `Shared`, `Trash`, `Settings`
  - folder explorer layout
  - folder CRUD and navigation
- Out:
  - uploads
  - public sharing
  - preview generation

## Dependencies

- Phase 01 complete

## Action Items

- [ ] Implement the signed-in shell layout with persistent sidebar and top-bar search slot.
- [ ] Add the route structure for the primary signed-in sections and separate `/admin`.
- [ ] Create the per-user library root model and folder hierarchy server logic.
- [ ] Implement folder listing, breadcrumb navigation, rename, move, trash, and restore metadata flows.
- [ ] Make list view the default explorer presentation and reserve grid view as an option.
- [ ] Ensure members see only their own namespace and owner still cannot browse member private content.
- [ ] Add tests for route guards, folder navigation, and move/rename identity behavior.

## Validation

- Verify shell navigation matches the locked information architecture.
- Verify folder rename/move updates metadata without changing physical file identity.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Done Criteria

- The signed-in product feels like a real file explorer instead of a placeholder dashboard.
- The private-drive model is stable enough to support uploads next.
