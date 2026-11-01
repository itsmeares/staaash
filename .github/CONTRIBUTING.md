# Contributing

Staaash is maintained by one person. Contributions are welcome, but opening a pull request does not create an obligation to merge it. The project is still early, and keeping its scope and direction under control matters.

## Read this first

- Use [GitHub Discussions](https://github.com/itsmeares/staaash/discussions) for questions, ideas, and non-trivial product changes.
- Use issues for bugs and narrowly scoped fixes.
- Keep pull requests small enough to understand in one sitting.
- Do not mix unrelated changes together.

## What fits

The work most likely to fit is:

- focused bug, reliability, or security fixes
- small performance or usability improvements
- documentation that helps users or operators
- tests for a real regression
- maintenance that keeps the project healthy without changing its direction

## What probably does not fit

Please discuss these before opening a pull request:

- large new features
- broad rewrites or drive-by refactors
- changes that introduce a new abstraction without a concrete need
- product ideas that expand Staaash beyond a personal or small-group file drive
- a large bundle of changes that is difficult to review

## Opening a pull request

Explain what changed and why it should exist. Describe the user-visible or operational impact, especially for changes involving storage, authentication, the database, or recovery. Keep the pull request description in your own words.

For UI changes, include before and after screenshots. For motion or timing changes, include a short video. If a change is hard to explain from the diff, it is probably too large or needs a design discussion first.

## AI-assisted contributions

AI tools are allowed here. They do not change the contribution standard: understand the important parts of your change, check the behavior, and be able to explain it when someone asks.

Do not have an agent open a pull request, write public replies, or answer maintainer questions without checking the content yourself. Pull requests that look like unreviewed generated output may be closed without review.

## Development setup

1. Copy `dev.example.env` to `.env.local` at the repo root.
2. Start PostgreSQL.
   The default `.env.local` expects `postgresql://staaash:staaash@localhost:5432/staaash`.
   If you want a local Docker container that matches those values, run:

   ```console
   docker run --name staaash-postgres -e POSTGRES_USER=staaash -e POSTGRES_PASSWORD=staaash -e POSTGRES_DB=staaash -p 5432:5432 -v staaash-postgres-data:/var/lib/postgresql -d postgres:18-alpine
   ```

   After that first run, restart it later with `docker start staaash-postgres`.
   If you already have PostgreSQL running another way, update `DATABASE_URL` in `.env.local`.

3. Run `pnpm i`.
4. Run `pnpm db:generate`.
5. Run `pnpm db:push`.
6. Start the web app with `pnpm web:dev`. It serves the app on port 3000 and
   the API on port 3001 (`STAAASH_API_PORT`), and reloads both on change.
7. Start the worker with `pnpm worker:dev`.

For frontend visual work, run `pnpm i` and `pnpm web:ui`, then open `/__ui`
on port 3002. This preview needs no environment file, PostgreSQL, Docker, or
worker. It uses the real frontend with sample accounts, files, and admin data.
The controls let you choose a starting state and reset its samples. Each browser
session has its own in-memory data. Refresh keeps changes; reset or restarting
the preview clears them. Idle sessions expire after two hours; the preview keeps
up to 16 sessions. Sample uploads have a combined 16 MiB limit per session.
New share links exist only in the browser session that created them. To check
one as a visitor, sign out and open it in the same browser context. Seeded links
work in separate contexts; cross-browser sharing needs a real demo.
Use `--host <address> --port <port>` to choose a private network binding.
Run `pnpm --filter web test:ui` for its request checks and
`pnpm --filter web e2e:ui` for its browser checks. Use the real demo below for
storage, authentication, database, and worker verification.

The desktop app lives in `apps/desktop`. Run it with
`pnpm desktop:dev`, then sign in to
your development server at `http://localhost:3000`.

## Application tests

Run `pnpm web:e2e`. It builds a Docker image from your checkout, creates its own
PostgreSQL, files directory and network, seeds fake accounts, runs the browser
and system tests, and removes the stack. It never uses the development database.
Pass browser test paths, such as `pnpm web:e2e e2e/member-files.spec.ts`, to run
only those files. Set `STAAASH_TEST_IMAGE` to test an image you already built.
The system tests also run the desktop sync engine against that stack. To run
those tests alone, point `STAAASH_SYNC_TEST_ORIGIN` at a stack seeded with the
fake accounts and run `vp run --filter desktop test`.
Database-only tests use `pnpm test:postgres` with an explicit
`POSTGRES_TEST_DATABASE_URL`; they create and remove their own database.

For a visual comparison of a UI change, run
`STAAASH_TEST_VISUAL=true pnpm web:e2e --update-snapshots` on `main` to save
screenshots under `apps/web/.data/visual/`, then run
`STAAASH_TEST_VISUAL=true pnpm web:e2e` on your branch to compare against them.

CI runs the same database and application suites on native AMD64 and ARM64.
Browser, application and selected upgrade suites run on separate runners with
their own temporary stacks. They reuse one image built for each architecture.
Upgrade and recovery checks run for relevant changes, manual extended runs and
release version changes. The source upgrade image comes from the published stable
release's immutable digest. Coverage runs on main and manual runs; PRs keep the
fast tests without coverage collection.

## Releases

Run the Release workflow with `version` from `main` or a `release/X.Y` branch.
The release branch must match the tag's major and minor version. For example,
`release/2.0` accepts `v2.0.1` and `v2.0.1-rc.1`, but rejects `v2.1.0`.
The selected branch must contain the release workflow and tooling. For a patch
to an older release, start from that release and carry over the release tooling
without copying newer app changes. The exact release and tooling commits must
pass push CI on the selected branch.

To recover a partial release, run the workflow from the same source branch with
`tag` and the exact `release_id`, leaving `version` empty. Direct tag pushes use
`main` when it contains the tagged commit, otherwise the matching `release/X.Y`
branch. Prereleases do not update stable `latest`, and older stable releases do
not replace a newer stable image.

After the server release is published, the release builds the desktop
installers on Windows, macOS and Linux and attaches them to the same release.
If only that step fails, rerun its failed jobs.

## Issues and security

- Use the GitHub issue forms for bug reports and feature requests.
- Do not open public issues for security problems.
- Follow [`SECURITY.md`](./SECURITY.md) for private reporting guidance.
