# Phase 04: Public Sharing

## Approach

Add secure public sharing without introducing collaboration permissions or ownership ambiguity.

## Scope

- In:
  - file links
  - folder links
  - expiry
  - password protection
  - revoke/delete
  - optional download disable
  - shared subtree browsing
- Out:
  - user-to-user sharing
  - recipient re-sharing
  - hidden subtree filtering

## Dependencies

- Phase 03 complete

## Action Items

- [ ] Extend the share-link data model with download policy and token/password controls.
- [ ] Implement share-link create, revoke, delete, and password-rotation flows.
- [ ] Implement public file views and folder subtree browsing routes.
- [ ] Enforce inherited share-link controls on nested folder items.
- [ ] Disable file download and folder archive download when the link policy disables download.
- [ ] Add tests for expiry, revoke, password access, subtree traversal, and download-disabled behavior.

## Validation

- Verify folder visitors can browse the full linked subtree and nothing outside it.
- Verify recipients cannot widen access or create new links.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Done Criteria

- Public sharing is secure, predictable, and still clearly not collaboration.
