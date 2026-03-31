# Staaash

Staaash is a self-hosted personal cloud drive I’m building in public.

The idea is simple: I want a storage app with predictable behavior around uploads, file layout, sharing, search, and recovery. This repo is the new foundation for that work.

## Current status

This is still an early-stage project, not a finished product yet.

What is already here:

- a Next.js App Router web app
- a small worker runtime
- a Prisma/PostgreSQL metadata layer
- completed Phase 2 signed-in workspace shell and private library navigation
- tested server-side modules for uploads, sharing, search, restore logic, auth flows, health checks, and library-folder behavior

What is not true yet:

- it is not feature-complete
- it is not packaged for one-command deployment
- it is not ready to replace something like Google Drive or Dropbox

I’m okay with that. The goal of this repo is to show real progress, not pretend it is further along than it is.

## What I’m focusing on now

- upload pipeline and file operations
- checksum verification and staging lifecycle
- keeping metadata operations safe while file ingest becomes real

## What is already locked in

- immutable ID-based storage paths
- upload policy and checksum verification rules
- sharing boundaries
- search normalization and ranking rules
- owner-facing health and operational visibility
- restore and reconciliation behavior

## Why this repo exists

I wanted the project to start from clear storage and operational rules instead of bolting them on later.

That means this repo is intentionally heavy on core behavior and documentation first:

- how files are stored
- how uploads are validated
- what sharing is allowed to do
- what the admin surface should report
- how restore should behave when reality and metadata drift apart

## Tech stack

- Next.js
- React
- TypeScript
- PNPM workspaces + Turborepo
- Prisma
- PostgreSQL
- Vitest

## Project layout

- `apps/web` - web app and server routes
- `apps/worker` - background worker runtime
- `packages/config` - shared TypeScript config
- `packages/db` - Prisma schema and DB helpers
- `docs` - architecture notes, implementation plan, phase docs, and operational notes

## Running it locally

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL and set `DATABASE_URL` in `.env`.
3. Run `pnpm install`.
4. Run `pnpm db:generate`.
5. Start the web app with `pnpm --filter web dev`.
6. Start the worker with `pnpm --filter worker dev`.

## Quality checks

- `pnpm format:check`
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## Docs

- `docs/implementation-plan.md`
- `docs/phases/README.md`
- `docs/architecture.md`
- `docs/decision-log.md`
- `docs/operations/backup-restore.md`

## Notes

This is my first public repo, so I’m trying to keep it honest, readable, and technically clean. If you take a look and have feedback, that’s useful.
