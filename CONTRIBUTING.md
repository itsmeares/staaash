# Contributing

Thanks for taking a look at the project.

This repo is intentionally straightforward: focused changes, honest docs, and working code. If you want to contribute, that is welcome.

## Before You Start

- keep changes focused and reviewable
- add or update tests for behavior changes
- do not commit secrets, runtime data, or generated local storage contents
- prefer small follow-up PRs over unrelated bundle changes
- AI-assisted changes are fine, but you are still responsible for reviewing, testing, and accurately describing them

## Local Setup

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL.
   The default `.env.example` expects `postgresql://staaash:staaash@localhost:5432/staaash`.
   If you want to run PostgreSQL in Docker locally, use:

   ```console
   docker run --name staaash-postgres -e POSTGRES_USER=staaash -e POSTGRES_PASSWORD=staaash -e POSTGRES_DB=staaash -p 5432:5432 -v staaash-postgres-data:/var/lib/postgresql/data -d postgres:18
   ```

   After that first run, you can restart it later with `docker start staaash-postgres`.
   If you already have PostgreSQL running another way, update `DATABASE_URL` to match your setup.

3. Run `pnpm install`.
4. Run `pnpm db:generate`.
5. Start the web app with `pnpm --filter web dev`.
6. Start the worker with `pnpm --filter worker dev`.

## Checks Before Opening A PR

- staged files are auto-formatted on commit
- CI still verifies formatting repo-wide with `pnpm format:check`
- run `pnpm lint`
- run `pnpm test`
- run `pnpm build`

## Pull Requests

- explain the user-visible or operational impact
- call out schema, auth, storage, or restore behavior changes when they apply
- complete the pull request template, including the validation checklist

## Issues And Security

- use the GitHub issue forms for bug reports and feature requests
- use a blank issue for feedback that does not fit the forms
- do not open public issues for security problems
- follow [`SECURITY.md`](./SECURITY.md) for private reporting guidance

## Project Context

If you are new to the repo, start with:

- [`README.md`](./README.md)
- [`docs/README.md`](./docs/README.md)
- [`docs/implementation-plan.md`](./docs/implementation-plan.md)
