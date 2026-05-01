# Staaash

[![AGPL-3.0 License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)

Staaash is a self-hosted personal cloud drive I am building in public.

The goal is not to clone a larger product feature-for-feature. The goal is to build a storage app with predictable behavior around uploads, file layout, sharing, search, and recovery, then make those rules explicit in the code and docs.

Think of it as the [Immich](https://github.com/immich-app/immich) for files.

## Current Status

v1 is feature-complete.

What is shipped:

- signed-in workspace with Files, Recent, Favorites, Shared, Trash, and Settings
- nested folder navigation with breadcrumbs, create, rename, move, trash, and restore
- staged upload pipeline with checksum verification and atomic commit
- public share links with expiry, optional password, download-disable, and folder subtree browsing
- inline viewers for image, video, PDF, text, and audio files
- private search, favorites, and recents
- worker job loop for trash retention, staging cleanup, and update checks
- owner admin surface for users, invites, storage, jobs, health, and update status
- restore reconciliation with missing-original and orphaned-storage reporting
- integration tests and Playwright E2E smoke harness

Self-hosting readiness is tracked in [#21](https://github.com/itsmeares/staaash/issues/21).

## Installation

Requirements: [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

```console
curl -L https://github.com/itsmeares/staaash/releases/latest/download/docker-compose.yml -o docker-compose.yml
curl -L https://github.com/itsmeares/staaash/releases/latest/download/.env.example -o .env
```

Open `.env` and set `DB_PASSWORD` to a secure value, then:

```console
docker compose up -d
```

Staaash is now running at `http://localhost:2113`.

The first account you register becomes the owner. Subsequent accounts require an invite from the owner.

### Upgrading

```console
docker compose pull
docker compose up -d
```

Migrations run automatically on startup.

### Data locations

| What           | Default path |
| -------------- | ------------ |
| Uploaded files | `./library`  |
| Database       | `./postgres` |

Both paths are relative to where `docker-compose.yml` lives. Change them in `.env` before first run.

## Core Behavior

- immutable ID-based physical storage — rename and move never touch the binary on disk
- staged uploads with checksum verification before commit
- explicit sharing boundaries — no silent re-share, no hidden subtree filtering
- deterministic search: case-insensitive, accent-insensitive, path-token aware
- owner health and operational visibility as a first-class surface
- restore requires reconciliation instead of silent best effort

## Tech Stack

- Next.js
- React
- TypeScript
- PNPM workspaces
- Turborepo
- Prisma
- PostgreSQL
- Vitest
- Playwright

## Repository Layout

- `apps/web` - web app and server routes
- `apps/worker` - background worker runtime
- `packages/config` - shared TypeScript config
- `packages/db` - Prisma schema and DB helpers
- `docs` - architecture reference

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

## Resetting Local Data

If you need to reset your local database and file uploads during development:

```console
pnpm app:reset-local-data
```

This will:

- Delete all local file uploads (`.data/files`)
- Reset the Prisma database schema with `prisma db push --force-reset`

**Note:** Use this script to reset your database please, you may have data remain if you do it manually.

## Quality Checks

- staged files are auto-formatted on commit
- `pnpm format:check`
- `pnpm format` for one-off repo-wide formatting or intentional normalization
- `pnpm lint`
- `pnpm test`
- `pnpm build`

## Documentation

- [`docs/architecture.md`](./docs/architecture.md) - system shape, storage model, and design boundaries

## AI Use

AI is being used in this project as part of the development and documentation workflow.

That does not change the quality bar. Generated code or generated docs still need to be reviewed, tested, and kept consistent with the repo's actual behavior.

## Contributing And Feedback

- read [`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening work
- use the GitHub issue forms for bug reports and feature requests
- use the PR template when opening changes
- report security problems privately as described in [`SECURITY.md`](./SECURITY.md)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=itsmeares/staaash&type=Date)](https://star-history.com/#itsmeares/staaash&Date)

## License

AGPL-3.0 — see [LICENSE](./LICENSE).
