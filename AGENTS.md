# Staaash

Staaash is a self-hosted personal cloud drive. A Next.js web app and a separate
worker share one PostgreSQL database and one local storage volume.

## What Staaash does not compromise on

1. **Files are safe.** Every storage change survives a crash or restart. When
   the outcome is unclear, keep every byte and stop.
2. **One box to run.** Docker, PostgreSQL, and a disk. No extra services.
3. **Small on purpose.** A drive for one person or a small group, not a
   collaboration suite or a platform. See
   [what fits](.github/CONTRIBUTING.md#what-fits).

## Where code lives

- `apps/web` contains the Next.js app. Routes and UI live in `app/`,
  request-time logic in `server/`, and shared UI in `components/ui`.
- `apps/worker` contains background jobs: cleanup, trash retention, media
  derivatives, zip archives, and restore reconciliation.
- `packages/db` contains the Prisma schema, migrations, and client.
- `packages/config` contains runtime paths, upload staging, and version code
  shared by both apps.
- `scripts` contains local maintenance and release tooling.
- `docs/architecture.md` contains the locked storage, sharing, and restore
  rules. Read it before changing those areas.

Dev setup lives in [CONTRIBUTING.md](.github/CONTRIBUTING.md#development-setup).

## Storage terms

- **storageId** is a user's stable storage key. Active files live at
  `files/<storageId>/<logical path>`.
- **logical path** is the readable folder hierarchy, the same in metadata and
  on disk.
- **mutation journal** is the `StorageMutation*` tables plus the executor in
  `durable-storage-mutation.ts`. Rename, move, trash, restore, and upload
  commits all go through it.
- **staging** is `UPLOAD_LOCATION/tmp/`, where uploads wait for checksum
  verification.
- **derivative** is generated output such as thumbnails, posters, and zip
  archives. It can always be rebuilt from originals.
- **reconciliation** is the restore check that compares metadata with disk
  instead of trusting either one.
- **owner** is the account that set up the instance. Owner authority is
  operational and does not bypass member privacy.

## Understand the goal

Understand what the user is trying to achieve. Do not blindly follow the steps
they suggest. If their approach would make the code worse, explain why and
choose a better approach. Ask first if the better approach would change what
users can do or put their data at risk.

Read the real code path and its callers before changing it. Do not assume that
existing code, tests, issues, or docs are correct. Check them against the real
product. AI-written issues and plans are clues, not requirements.

If a rule here fights the task in front of you, say so loudly and get a human
sign-off before breaking it.

## Keep the product, replace bad code

Preserve the features people can use, stored files and metadata, share links,
and public behavior that real callers rely on. Internal code structure is not a
contract. Bugs are not features.

Fix the root cause where the behavior is owned. Do not add the same patch to
each caller. Aim for the simplest whole system after the change, not the
smallest diff.

Prefer deleting code over adding another layer. When replacing an old path,
remove it in the same change. Do not leave parallel implementations, fallback
chains, wrappers, compatibility shims, or feature flags unless a released
version still needs them.

Before adding code, check whether the need can be removed or handled by code
already in the repository, the standard library, the platform, or an installed
dependency. Do not add abstractions, dependencies, or scaffolding for possible
future needs.

## Protect real data

1. **Do not bypass the journal.** Never rename, move, or delete anything under
   `UPLOAD_LOCATION` outside the mutation journal. A raw `fs.rename` passes the
   test and loses a file after the first crash.
2. **Do not weaken recovery.** Do not turn a fail-closed path into best-effort
   cleanup, swallow an ambiguous outcome, or drop a safety check, warning, or
   backup to make the code smaller.
3. **Do not wipe the shared database.** Every checkout's `.env.local` points at
   the same `staaash` database by default. `pnpm app:reset-local-data` runs
   `prisma db push --force-reset`, `pnpm web:e2e` runs
   `prisma migrate reset --force`, and `pnpm db:push` changes the schema under
   every other worktree. Point them at a demo database instead, or ask first.
   `test:postgres` is safe because it creates its own `staaash_test_*`
   database.
4. **Do not touch the real install.** The repo's `docker-compose.yml` uses the
   project name `staaash` and the containers `staaash_server`,
   `staaash_worker`, and `staaash_postgres`. On the maintainer's machine those
   are the live install with real files. Never run `docker compose` against
   that project. Leave other `staaash-*` stacks alone too; another agent may be
   using them.
5. **Do not kill by pattern.** Other worktrees run their own dev servers and
   demos. Stop only the PIDs and containers you started.

## Use a demo instance

To test, reproduce a bug, take screenshots, or experiment, start your own
Staaash instance. Inside it, anything goes: seed, reset, break, and restart.

- Give it its own compose project (`-p staaash-<task>`), its own image built
  from the worktree, its own PostgreSQL, and its own files directory. Keep its
  state outside the worktree, for example in
  `~/.local/share/staaash-qa/<task>/`.
- Pick free ports. Never use 2113 or 5432. Bind PostgreSQL to `127.0.0.1`.
- Seed fake data only. The e2e bootstrap accounts such as
  `owner-e2e@staaash.test` are fine to reuse. Never copy real files, databases,
  or secrets into a demo.
- Cap CPU and memory in the compose file. The dev machine is small.
- If the user opens it from another device, bind the web port to the machine's
  Tailscale or LAN address instead of `127.0.0.1`. Do not post that URL
  anywhere public.
- When done, or when the user asks, remove the containers, volumes, images, and
  state directory you created. Say what is still running.

## Check every path

A change that works on one path can still break another. When the changed
behavior depends on them, check the relevant paths:

- the web request and the worker job. The journal executor exists in both
  `apps/web/server/` and `apps/worker/src/` on purpose, so change both;
- the owner, a member, and an anonymous share link visitor;
- a crash or restart mid-upload or mid-mutation;
- quota, resumable upload limits, overlong paths, and a full disk;
- `pnpm web:dev` and the Docker image on AMD64 and ARM64;
- light and dark themes, wide and narrow screens;
- the way back out: trash needs restore, share needs revoke.

Do not test every path by default. Decide which ones the change can affect and
say which ones were checked.

## Bugs and scope

Fix a bug found in the code path being changed when its cause is clear and the
fix can be checked. Do not create a separate task for it.

If a proven bug is outside the changed path, open a focused issue and tell the
user. Do not open issues for guesses, code smells, or possible future problems.
Do not turn the current work into unrelated cleanup.

## Tests and checks

Existing tests are not automatically correct. Keep tests that prove real
features. Change or remove tests that only lock in old code structure or broken
behavior. Test what a user can observe, not the implementation.

Run checks for the changed area only:

- `pnpm --filter web test server/foo.test.ts` for touched tests. Same for
  `worker` and `@staaash/db`.
- `pnpm --filter web typecheck`. `pnpm --filter web lint` also runs the style
  check.
- `pnpm --filter web test:postgres <files>` for database behavior. It needs a
  reachable PostgreSQL.
- `pnpm quality:fallow`, which only checks new code against `origin/main`.

Do not run repo-wide `pnpm test`, `pnpm lint`, `pnpm build`, or the full e2e
suite unless the user asks. CI runs them. Do not open a browser unless the user
asks. Never claim that a check passed unless it was run and passed.

Before finishing, search for callers and leftovers from any path that was
replaced. Remove dead code and report what was checked and what was not.

## Taste

- Complexity belongs in the journal and recovery code. Routes stay thin, UI
  stays simple.
- `components/ui` components own their look. Pick a `variant` or `size`
  instead of restyling with `className`.
- `app/globals.css` only imports. Nothing uses `!important`, and text uses
  `foreground` at 80% or more, or `muted-foreground`. `check-styles.mjs`
  enforces this.
- Inferred types over annotations. No `any`.
- Comments explain why and move with the code.

## Pull requests

Do not create a pull request unless the user asks for one.

Use a short conventional commit title in plain language, such as
`fix(files): keep uploads after restart`. Fill in the
[PR template](.github/pull_request_template.md). Call out schema, auth,
storage, or restore changes. List the checks that were run and any relevant
checks that were not. End the body with the model and agent tool that did the
work.

For a visible UI change, include before and after images. Use a short video when
movement or timing matters. Upload review-only evidence to the pull request; do
not commit it to the repository.

Keep each pull request centered on one goal. Do not edit `CHANGELOG.md`; it is
written at release time.

When watching a pull request, read checks and comments from the latest push.
Check every bot report against the real code. Fix real problems and answer
false reports with a clear reason. Stop when the latest commit is green.

## Documentation and plans

Most code changes do not need new docs. Add documentation only when the code
cannot clearly carry the reason, or when the way people run Staaash changes.
`docs/architecture.md` holds design rules and `docs/operations/` holds operator
procedures.

When old documentation becomes wrong, rewrite or remove it. Do not add a second
explanation beside it. Do not commit plans, research notes, or agent scratch
files. Keep them outside the worktree.
