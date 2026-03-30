# Phase 00: Foundation Scaffold

## Status

Completed

## Approach

Establish the fresh repo, workspace structure, environment contract, and core behavior helpers before product features begin.

## Scope

- In:
  - Turborepo + pnpm workspace
  - Next.js web app shell
  - worker heartbeat runtime
  - Prisma baseline schema
  - storage/upload/search/sharing/health helper modules
  - backup/restore baseline docs
- Out:
  - real auth flows
  - real library CRUD
  - uploads and sharing endpoints

## Action Items

- [x] Create the fresh `staaash` workspace and preserve the old repo as `staaash-old`.
- [x] Add root workspace config, scripts, and package layout.
- [x] Add the web app shell, worker runtime, and shared DB package.
- [x] Encode immutable storage, upload guardrails, sharing rules, search normalization, and health contracts.
- [x] Add backup/restore and architecture documentation.
- [x] Add tests for the implementation-behavior rules.
- [x] Verify the workspace with install, test, lint, and build.

## Validation

- `pnpm test`
- `pnpm lint`
- `pnpm build`

## Done Criteria

- The repo is usable as the new implementation target.
- The core behavior rules are encoded in code and tests, not just docs.
