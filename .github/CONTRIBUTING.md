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
6. Start the web app with `pnpm web:dev`.
7. Start the worker with `pnpm worker:dev`.

## Issues and security

- Use the GitHub issue forms for bug reports and feature requests.
- Do not open public issues for security problems.
- Follow [`SECURITY.md`](./SECURITY.md) for private reporting guidance.
