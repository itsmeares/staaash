# Phase 05: Search, Favorites, Recents, and Trash

## Status

Completed

## Goal

Ship the private-library retrieval layer so everyday file access feels complete, not placeholder-level.

## Locked Product Behavior

- Search, favorites, and recents cover private, non-trashed files and folders only.
- Shared content stays out of scope for this phase.
- Favorites are bookmarks only. They do not boost search ranking or library ordering.
- `/recent` is one row per item, ordered by latest interaction time.
- Search lives at `/search?q=...` and returns one mixed ranking across files and folders.
- Trash keeps per-file permanent delete and adds one explicit bulk `Empty trash` action.
- Private file open is implemented as authenticated attachment download so file access can truthfully populate recents.
- The library root is excluded from search, favorites, and recents.
- Pagination is intentionally deferred. It will be added later once the product decision is made.

## Architecture

- Add dedicated retrieval code under `apps/web/server/retrieval/`.
- Keep `apps/web/server/search.ts` as the pure normalization and ranking helper.
- Extend search tie-breaking to be deterministic: `matchKind`, `updatedAt desc`, normalized path ascending, normalized name ascending, then `id` ascending.
- Keep favorite and recent state in dedicated tables instead of adding flags or timestamps to `File` and `Folder`.
- Touch `apps/web/server/library/service.ts` only for storage-backed trash lifecycle expansion, specifically bulk trash clear for top-level trashed folder trees plus standalone trashed files.

## Data Model

- Add `FavoriteFile`, `FavoriteFolder`, `RecentFile`, and `RecentFolder`.
- `Favorite*` rows store `userId`, target id, and `createdAt`, with unique keys on user-target pairs.
- `Recent*` rows store `userId`, target id, and `lastInteractedAt`, with unique keys on user-target pairs.
- Add list indexes for favorites by `[userId, createdAt]` and recents by `[userId, lastInteractedAt]`.
- Keep `updatedAt` on `File` and `Folder` reserved for library object changes, not retrieval metadata.

## Retrieval Rules

### Search

- Owner-scoped and active-only.
- Match against normalized names and logical path labels built from the folder tree.
- Result rows include kind, id, name, path label, href, updated time, favorite state, and row-action metadata.
- States are: empty query, no results, and populated results.
- No live suggestions, incremental filtering, or pagination in this phase.

### Favorites

- Users can favorite files and folders.
- Favorite toggles surface in library, search, and recent views.
- Favorite toggles must be idempotent and owner-scoped.

### Recents

- Recents are current-state tables, not audit history.
- Record recents for:
  - successful non-root folder navigation
  - successful authenticated file download/open
  - folder creation
  - file upload
  - rename
  - move
  - trash
  - restore
- Do not create recent rows for favorite toggles or root library visits.

### Trash

- Keep current per-file permanent delete behavior.
- Bulk clear permanently removes all top-level trashed folder roots recursively plus standalone trashed files.
- Do not add per-folder hard-delete buttons in this phase.
- Bulk clear returns counts so the UI can show a precise success message.

## Routes And UI

- Replace the disabled top-bar search input with a GET form targeting `/search`.
- Add a dynamic server-rendered `/search` page.
- Replace placeholder `/favorites` and `/recent` pages with real listings.
- Add authenticated private file download at `GET /api/library/files/[fileId]/download`.
- Add favorite toggle endpoints for files and folders.
- Add `POST /api/library/trash/clear`.
- Add favorite toggles plus authenticated file download links in the library explorer.

## Validation

- [x] Run `pnpm db:generate`.
- [x] Run `pnpm test`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm build`.

## Done Criteria

- Users can search, favorite, revisit, download, restore, and permanently clear private content with deterministic behavior.
- Phase docs explicitly record that pagination was deferred intentionally rather than omitted accidentally.

## Completion Notes

- Added dedicated retrieval services for mixed-item search, favorites, and recents.
- Replaced placeholder `/favorites` and `/recent` routes and shipped a real `/search` page.
- Added authenticated private file download so recents can reflect actual file access.
- Added favorite toggles across retrieval surfaces and bulk `Empty trash` with precise deletion counts.
