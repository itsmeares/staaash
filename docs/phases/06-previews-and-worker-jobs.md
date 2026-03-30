# Phase 06: Previews and Worker Jobs

## Approach

Turn the worker from a heartbeat runtime into the actual durable background executor for jobs and preview generation.

## Scope

- In:
  - Postgres-backed job claiming
  - retry behavior
  - preview generation
  - trash retention
  - staging cleanup
  - update checks
- Out:
  - Redis/BullMQ
  - Office preview rendering
  - ML-heavy processing

## Dependencies

- Phase 03 complete
- Phase 04 and Phase 05 can proceed in parallel, but worker infrastructure must be stable before they depend on it heavily

## Action Items

- [ ] Implement the durable job model with claim, lock, retry, and dead-job behavior.
- [ ] Replace the heartbeat-only worker loop with real job polling and execution.
- [ ] Add preview generation handlers for supported preview kinds.
- [ ] Add trash retention and staging cleanup handlers.
- [ ] Add update-check handler scaffolding for the admin surface.
- [ ] Expose queue backlog and worker heartbeat state in admin health.
- [ ] Add tests for retry rules, restart safety, and preview fallback behavior.

## Validation

- Verify jobs survive restarts and are not double-claimed.
- Verify preview failure never blocks access to original files.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Done Criteria

- The worker owns background execution in a durable and observable way.
