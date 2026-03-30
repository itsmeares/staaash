# Contributing

Thanks for taking a look at the project.

This is my first public repo, so I’m trying to keep the bar simple: clear changes, honest docs, and working code. If you want to contribute, that’s welcome.

## Ground rules

- Keep changes focused and reviewable.
- Add or update tests for behavior changes.
- Run `pnpm format:check`, `pnpm lint`, `pnpm test`, and `pnpm build` before opening a PR.
- Do not commit secrets, runtime data, or generated local storage contents.

## Development

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL and set `DATABASE_URL`.
3. Run `pnpm install`.
4. Run `pnpm db:generate`.
5. Start the app with `pnpm --filter web dev`.
6. Start the worker with `pnpm --filter worker dev`.

## Pull requests

- Explain the user-visible or operational impact.
- Call out schema, auth, storage, or restore behavior changes explicitly.
- Prefer small follow-up PRs over unrelated bundle changes.

## Feedback

Issues and PRs are both useful.

If something feels unclear, under-documented, or over-engineered, say so directly. That kind of feedback is genuinely helpful.
