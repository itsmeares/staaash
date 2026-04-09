# Staaash

Staaash is a self-hosted personal cloud drive I am building in public.

The goal is not to clone a larger product feature-for-feature. The goal is to build a storage app with predictable behavior around uploads, file layout, sharing, search, and recovery, then make those rules explicit in the code and docs.

## Current Status

This repository is still early-stage. It is real software, but it is not a finished product.

What is already here:

- a Next.js App Router web app
- a worker runtime for background behavior
- a Prisma and PostgreSQL metadata layer
- completed Phases 2 through 8 for signed-in workspace navigation, uploads, sharing, retrieval, worker jobs, the owner admin surface, and restore reconciliation
- tested server-side modules for uploads, sharing, search, restore logic, auth flows, health checks, background jobs, admin storage reporting, and library-folder behavior

What is not true yet:

- it is not feature-complete
- it is not packaged for one-command deployment
- it is not ready to replace something like Google Drive or Dropbox

That is intentional. This repo is meant to show honest progress, not imply more maturity than it has earned.

## What Exists Today

The current foundation already locks in several important behaviors:

- immutable ID-based physical storage paths
- PostgreSQL-backed metadata
- staged uploads with checksum verification rules
- explicit sharing boundaries
- deterministic search normalization and ranking rules
- owner-facing health and operational visibility
- restore behavior that requires reconciliation instead of silent best effort
- owner-visible restore integrity reporting and manual reconciliation

## Current Focus

The current major slice is release-quality hardening in Phase 08.

That work is centered on:

- manual owner-triggered restore reconciliation
- integrity visibility for missing originals and orphaned storage
- release-quality verification across admin, library, sharing, and recovery paths
- a thin browser smoke harness for the highest-risk journeys

## Tech Stack

- Next.js
- React
- TypeScript
- PNPM workspaces
- Turborepo
- Prisma
- PostgreSQL
- Vitest

## Repository Layout

- `apps/web` - web app and server routes
- `apps/worker` - background worker runtime
- `packages/config` - shared TypeScript config
- `packages/db` - Prisma schema and DB helpers
- `docs` - architecture notes, roadmap, phase docs, and operational notes

## Local Development

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL.
   The default `.env.example` expects `postgresql://staaash:staaash@localhost:5432/staaash`.
   If you want a local Docker container that matches those values, run:

   ```console
   docker run --name staaash-postgres -e POSTGRES_USER=staaash -e POSTGRES_PASSWORD=staaash -e POSTGRES_DB=staaash -p 5432:5432 -v staaash-postgres-data:/var/lib/postgresql -d postgres:18
   ```

   After that first run, you can restart it later with `docker start staaash-postgres`.
   If you already have PostgreSQL running another way, just make sure `DATABASE_URL` in `.env` matches it.

3. Run `pnpm i`.
4. Run `pnpm db:generate`.
5. Run `pnpm db:push`.
6. Start the web app with `pnpm web:dev`.
7. Start the worker with `pnpm worker:dev`.

## Quality Checks

- staged files are auto-formatted on commit
- `pnpm format:check`
- `pnpm format` for one-off repo-wide formatting or intentional normalization
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## Documentation Map

Start here if you want the short version of how the repo is organized:

- [`docs/README.md`](./docs/README.md) - documentation index and reading order
- [`docs/architecture.md`](./docs/architecture.md) - high-level system shape and storage model
- [`docs/implementation-plan.md`](./docs/implementation-plan.md) - phased roadmap for the rewrite
- [`docs/decision-log.md`](./docs/decision-log.md) - stable decisions that are intentionally not being re-litigated
- [`docs/phases/README.md`](./docs/phases/README.md) - execution index for the phase documents
- [`docs/operations/backup-restore.md`](./docs/operations/backup-restore.md) - backup baseline and restore expectations

## AI Use

AI is being used in this project as part of the development and documentation workflow.

That does not change the quality bar. Generated code or generated docs still need to be reviewed, tested, and kept consistent with the repo's actual behavior.

## Contributing And Feedback

- read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening work
- use the GitHub issue forms for bug reports and feature requests
- use the PR template when opening changes
- report security problems privately as described in [`SECURITY.md`](./SECURITY.md)

## Notes

This is my first public repo. I want it to stay readable, technically honest, and useful to people following along. Direct feedback is welcome if something feels unclear or under-documented.
