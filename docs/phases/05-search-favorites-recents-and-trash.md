# Phase 05: Search, Favorites, Recents, and Trash

## Approach

Finish the retrieval layer so the product feels polished in everyday use, not just technically functional.

## Scope

- In:
  - filename/path search
  - favorites
  - recents
  - trash listing
  - restore and clear-trash behavior
- Out:
  - full-text search
  - metadata-advanced search

## Dependencies

- Phase 03 complete
- Phase 04 may be in progress, but private drive retrieval must not depend on sharing

## Action Items

- [ ] Implement search queries using the locked normalization and ranking rules.
- [ ] Add favorites and recents data flows to the main shell.
- [ ] Build trash listing, restore, and clear-trash UX.
- [ ] Ensure extension and path segment tokens contribute to search matching.
- [ ] Add tests for exact/prefix/substring ordering and recency tie-breaking.
- [ ] Add tests for trash restore and permanent deletion behavior.

## Validation

- Verify search is case-insensitive and accent-insensitive.
- Verify search ranking is deterministic.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Done Criteria

- Users can reliably find, favorite, revisit, and recover their content.
