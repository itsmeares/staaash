# Phase 07: Admin and Operational Surface

## Approach

Complete the owner-facing control plane so Staaash feels like a real self-hosted product for operators, not only for members.

## Scope

- In:
  - user management
  - invite management
  - storage usage visibility
  - health summary
  - update status
  - job monitor
- Out:
  - full audit console
  - quota policy engine
  - tenant management

## Dependencies

- Phase 01 complete
- Phase 06 largely complete for meaningful job and health visibility

## Action Items

- [ ] Implement `/admin` sections for users, invites, storage, jobs, and updates.
- [ ] Add storage usage aggregation and present it clearly.
- [ ] Surface the locked health checks: DB, files volume, worker heartbeat, queue backlog, disk warnings, version/update status.
- [ ] Ensure owner-only route protection across the full admin area.
- [ ] Add tests that members cannot access admin surfaces and owner health data is rendered correctly.

## Validation

- Verify the owner can manage the instance without browsing member private content.
- Verify operator warnings are actionable rather than generic.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Done Criteria

- The admin surface is a real operator product, not a diagnostics afterthought.
