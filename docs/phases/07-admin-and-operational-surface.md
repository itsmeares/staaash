# Phase 07: Admin and Operational Surface

## Approach

Complete the owner-facing control plane so Staaash feels like a real self-hosted product for operators, not only for members.

The admin surface remains part of the web app, but it is no longer a single mixed page. Phase 07 formalizes `/admin` as a small owner product with dedicated sections and a matching `/api/admin/*` namespace for owner-only operational APIs.

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

- [x] Split `/admin` into overview, users, invites, storage, jobs, and updates pages.
- [x] Add storage usage aggregation with instance totals and per-user retained usage.
- [x] Surface the locked health checks: DB, files volume, worker heartbeat, queue backlog, disk warnings, version/update status.
- [x] Move owner-only operational APIs under `/api/admin/*`.
- [x] Keep legacy owner-only `/api/auth/*` invite and reset routes as compatibility aliases for now.
- [x] Replace the placeholder update check with a real GitHub release lookup handled by the worker.
- [x] Add tests for the new owner-only API surface and the legacy password-reset compatibility path.

## Architecture Notes

- `/admin` is now the overview page.
- `/admin/users` handles inventory and owner-issued password resets.
- `/admin/invites` handles create, revoke, and reissue flows.
- `/admin/storage` shows aggregate retained usage and per-user breakdowns.
- `/admin/jobs` is intentionally read-only in this phase.
- `/admin/updates` reads worker-written update state and allows a manual check enqueue.
- Admin server orchestration lives under `apps/web/server/admin/`.
- DB-heavy storage and job aggregation live in `packages/db/src/admin.ts`.
- Public auth flows stay under `/api/auth/*`, while owner-only operational mutations and JSON routes live under `/api/admin/*`.
- Owner authority remains operational only. No private member content browsing is introduced.

## Validation

- Verify the owner can manage the instance without browsing member private content.
- Verify operator warnings are actionable rather than generic.
- Verify the update check distinguishes `unavailable` from real `error` states.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Done Criteria

- The admin surface is a real operator product, not a diagnostics afterthought.
