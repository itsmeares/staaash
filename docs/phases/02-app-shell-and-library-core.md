# Phase 02: App Shell and Library Core

## Status

Completed

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

- [x] Implement the signed-in shell layout with persistent sidebar and top-bar search slot.
- [x] Add the route structure for the primary signed-in sections and separate `/admin`.
- [x] Create the per-user library root model and folder hierarchy server logic.
- [x] Implement folder listing, breadcrumb navigation, rename, move, trash, and restore metadata flows.
- [x] Make list view the default explorer presentation and reserve grid view as an option.
- [x] Ensure members see only their own namespace and owner still cannot browse member private content.
- [x] Add tests for route guards, folder navigation, move/rename identity behavior, root canonicalization, and access control edge cases.

## Validation

- Verified shell navigation matches the locked information architecture across `Library`, `Recent`, `Favorites`, `Shared`, `Trash`, and `Settings`.
- Verified folder rename/move updates metadata without changing logical identity.
- Verified signed-in deep links preserve their exact return target through the sign-in flow.
- Verified the per-user library root is canonicalized and duplicate legacy roots auto-heal safely.
- Verified members only see their own namespace and owners still cannot browse member private folders by default.
- Ran `pnpm format:check`, `pnpm lint`, `pnpm test`, and `pnpm build`.

## Done Criteria

- The signed-in product feels like a real file explorer instead of a placeholder dashboard.
- The private-drive model is stable enough to support uploads next.
