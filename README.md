# Staaash

[![AGPL-3.0 License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)

> [!IMPORTANT]
> **Staaash is in beta.** Expect some bugs and breaking changes between pre-1.0 releases. Do not use it as your only copy of important files — set up a [3-2-1 backup strategy](https://www.backblaze.com/blog/the-3-2-1-backup-strategy/) before you start.

Staaash is a self-hosted personal cloud drive I am building in public.

This was just gonna be something that only I was going to use and share with some friends but I thought "why not I just do it open-source, maybe some people would like to see aswell" so I made it.

Think of it as the [Immich](https://github.com/immich-app/immich) for files.

## Screenshots

A quick look at the beta experience: a calm home dashboard, focused file management, and public sharing that still feels like your space.

<p align="center">
  <img src="./docs/assets/readme/home-dashboard-light.png" alt="Staaash home dashboard in light mode" width="100%">
</p>

<p align="center">
  <img src="./docs/assets/readme/files-dark.png" alt="Staaash files view in dark mode" width="49%">
  <img src="./docs/assets/readme/share-page-light.png" alt="Staaash public share page in light mode" width="49%">
</p>

## Installation

Requirements: [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

### Windows and Linux

1. Go to the [releases page](https://github.com/itsmeares/staaash/releases) and download `docker-compose.yml` and `example.env` into the same folder. Use the latest release, or pick a specific version if you need one. Files on `main` may include unreleased changes.
2. Rename `example.env` to `.env`, open it, set `DB_PASSWORD` to a secure value (You can use something like pwgen). Also, if you are running plain HTTP without HTTPS, set `SECURE_COOKIES` to `false`, and change any other values you want. `SECURE_COOKIES` only accepts `true` or `false` when set.
3. Run:

   ```console
   docker compose up -d
   ```

Staaash is now running at `http://localhost:2113`.

The first account you register becomes the owner. Subsequent accounts require an invite from the owner.

### Reverse proxies

If you put Staaash behind Caddy, Nginx, Traefik, or another reverse proxy, preserve the original `Host` header. Staaash rejects cross-origin mutating requests by comparing the browser `Origin` host to the request `Host`.

Use one public address consistently. Loading the app from `https://staaash.example.com` and posting to a direct server IP, LAN IP, or different port can fail by design.

If you run Staaash over plain HTTP, set `SECURE_COOKIES=false`. With HTTPS, leave secure cookies enabled.

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

## Tech Stack

Next.js · TypeScript · Prisma · PostgreSQL

## Repository Layout

- `apps/web` - web app and server routes
- `apps/worker` - background worker runtime
- `packages/config` - shared TypeScript config
- `packages/db` - Prisma schema and DB helpers
- `docs` - architecture reference

## Local Development

1. Copy `dev.example.env` to `.env.local` at the repo root.
2. Start PostgreSQL.
   The default `.env.local` expects `postgresql://staaash:staaash@localhost:5432/staaash`.
   If you want a local Docker container that matches those values, run:

   ```console
   docker run --name staaash-postgres -e POSTGRES_USER=staaash -e POSTGRES_PASSWORD=staaash -e POSTGRES_DB=staaash -p 5432:5432 -v staaash-postgres-data:/var/lib/postgresql -d postgres:16
   ```

   After that first run, you can restart it later with `docker start staaash-postgres`.
   If you already have PostgreSQL running another way, just update `DATABASE_URL` in `.env.local`.

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
- [`docs/operations/backup-restore.md`](./docs/operations/backup-restore.md) - simple backup and restore checklist

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
