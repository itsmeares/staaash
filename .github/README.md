<div align="center">
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="../design/App/Staaash%20App%20Icon-White%400.25.png">
    <source media="(prefers-color-scheme: dark)" srcset="../design/App/Staaash%20App%20Icon%400.25.png">
    <img src="../design/App/Staaash%20App%20Icon%400.25.png" alt="Staaash" width="192" height="192">
  </picture>
</p>
<h1>Staaash</h1>

[![AGPL-3.0 License](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/itsmeares/staaash?include_prereleases&label=release)](https://github.com/itsmeares/staaash/releases)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-blue)](https://github.com/itsmeares/staaash/pkgs/container/staaash)
[![Self-hosted](https://img.shields.io/badge/self--hosted-yes-brightgreen)](#installation)

</div>

> [!IMPORTANT]
> **Staaash is in beta.** Expect some bugs and breaking changes between pre-releases. Do not use it as your only copy of important files — set up a [3-2-1 backup strategy](https://www.backblaze.com/blog/the-3-2-1-backup-strategy/) before you start.

---

<p align="center">Staaash is a self-hosted file drive for people who want their files on their own server.</p>

<table>
  <tr>
    <td colspan="2">
      <img src="../docs/assets/readme/home-dashboard-light.png" alt="Staaash files view in light mode">
    </td>
  </tr>
  <tr>
    <td>
      <img src="../docs/assets/readme/files-light.png" alt="Staaash home dashboard in light mode">
    </td>
    <td>
      <img src="../docs/assets/readme/share-page-light.png" alt="Staaash public share page in light mode">
    </td>
  </tr>
</table>

## Why Use It

- Your files stay on storage you control.
- Sharing is built in, with public links for files and folders.
- Invite friends or family and give them their own space.
- Built for real home use: uploads, folders, sharing, backups, and restore checks.

Upload files, organize folders, invite trusted users, and share links without handing the whole thing to someone else's cloud. It is built for self-hosters who want something small enough to understand and useful enough to run at home.

If [Immich](https://github.com/immich-app/immich) is your self-hosted photo library, Staaash aims to be your self-hosted file drive.

## Installation

Requirements: [Docker](https://docs.docker.com/get-docker/) with the Compose plugin.

### Windows and Linux

1. Go to the [releases page](https://github.com/itsmeares/staaash/releases) and download `docker-compose.yml` and `example.env` into the same folder. Use the latest release, or pick a specific version if you need one. Files on `main` may include unreleased changes.
2. Rename `example.env` to `.env`, open it, set `DB_PASSWORD` to a secure value (you can use something like pwgen), and change any other values you want.
3. Run:

   ```console
   docker compose up -d
   ```

Staaash is now running at `http://localhost:2113`.

The first account you register becomes the owner. Subsequent accounts require an invite from the owner.

### Reverse proxies

For a working Caddy example, see [`docs/operations/reverse-proxy.md`](../docs/operations/reverse-proxy.md).

If you put Staaash behind Caddy, Nginx, Traefik, or another reverse proxy, preserve the original `Host` header. Staaash rejects cross-origin mutating requests by comparing the browser `Origin` host to the request `Host`.

Use one public address consistently. Loading the app from `https://staaash.example.com` and posting to a direct server IP, LAN IP, or different port can fail by design.

`SECURE_COOKIES` is optional. By default, Staaash uses secure cookies on HTTPS and non-secure cookies on plain HTTP. Only set `SECURE_COOKIES` if you need to force cookie behavior. If your HTTPS proxy forwards traffic to Staaash over HTTP, make sure it sends `x-forwarded-proto: https`.

### Upgrading

```console
docker compose pull
docker compose up -d
```

Migrations run automatically on startup.

Postgres major upgrades need extra care. Fresh installs use Postgres 18. Do not point the Postgres 18 container at an old Postgres 16 `postgres` folder by only changing the image tag. To keep beta data across this baseline change, use the Postgres 18 upgrade path in [`docs/operations/backup-restore.md`](../docs/operations/backup-restore.md).

### Data locations

| What           | Default path |
| -------------- | ------------ |
| Uploaded files | `./library`  |
| Database       | `./postgres` |

Both paths are relative to where `docker-compose.yml` lives. Change them in `.env` before first run.

With the default Postgres 18 container, `./postgres` is still the folder you back up. Inside the container, Postgres stores the actual cluster under its versioned data directory.

## Backup And Restore

Back up both the database and uploaded files. In the default Docker setup, that means backing up `./postgres` and `./library` together.

See [`docs/operations/backup-restore.md`](../docs/operations/backup-restore.md) for the restore checklist.

## Documentation

- [`docs/architecture.md`](../docs/architecture.md) - system shape, storage model, and design boundaries
- [`docs/operations/backup-restore.md`](../docs/operations/backup-restore.md) - simple backup and restore checklist

## Local Development

Staaash is a PNPM workspace monorepo.

Next.js · TypeScript · Prisma · PostgreSQL

### Repository Layout

- `apps/web` - web app and server routes
- `apps/worker` - background worker runtime
- `packages/config` - shared TypeScript config
- `packages/db` - Prisma schema and DB helpers
- `docs` - architecture reference

### Development Setup

1. Copy `dev.example.env` to `.env.local` at the repo root.
2. Start PostgreSQL.
   The default `.env.local` expects `postgresql://staaash:staaash@localhost:5432/staaash`.
   If you want a local Docker container that matches those values, run:

   ```console
   docker run --name staaash-postgres -e POSTGRES_USER=staaash -e POSTGRES_PASSWORD=staaash -e POSTGRES_DB=staaash -p 5432:5432 -v staaash-postgres-data:/var/lib/postgresql -d postgres:18-alpine
   ```

   After that first run, you can restart it later with `docker start staaash-postgres`.
   If you already have PostgreSQL running another way, just update `DATABASE_URL` in `.env.local`.

3. Run `pnpm i`.
4. Run `pnpm db:generate`.
5. Run `pnpm db:push`.
6. Start the web app with `pnpm web:dev`.
7. Start the worker with `pnpm worker:dev`.

### Resetting Local Data

If you need to reset your local database and file uploads during development:

```console
pnpm app:reset-local-data
```

This will:

- Delete all local file uploads (`.data/files`)
- Reset the Prisma database schema with `prisma db push --force-reset`

**Note:** Use this script to reset your database please, you may have data remain if you do it manually.

## Testing And Quality

- staged files are auto-formatted on commit
- `pnpm format:check`
- `pnpm format` for one-off repo-wide formatting or intentional normalization
- `pnpm lint`
- `pnpm test`
- `pnpm build`

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

AGPL-3.0 — see [LICENSE](../LICENSE).
