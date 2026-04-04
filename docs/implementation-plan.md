# Staaash Implementation Plan

## Summary

This document is the authoritative phased roadmap for the current `staaash` rewrite.

Use it to understand what the repo is building, which decisions are already locked in, which phases are complete, and what still needs to be delivered. For the numbered execution docs, use [`docs/phases/README.md`](./phases/README.md).

## Product Summary

Staaash is a self-hosted, Docker-first, web-first personal cloud drive for self-hosters who want a polished and trustworthy alternative to heavier self-hosted file products.

The benchmark is:

- Google Drive for information architecture and file-management ergonomics
- Immich for self-hosted product quality and operator experience

The product promise is:

- calm, professional UX
- safe-by-default behavior
- owner-operated self-hosting with a first-class admin experience
- strong upload, organization, and retrieval flows

## Locked Product And Architecture Decisions

### Product scope

- web app only in v1
- Docker and self-hosted only in v1
- personal-first model
- folders-first information architecture
- public links only for sharing in v1
- no desktop sync client in v1
- no mobile app in v1
- no internal collaboration permissions in v1
- no multi-tenant workspace model in v1

### Roles and trust

- roles are `owner` and `member`
- owner manages system and admin concerns
- owner does not browse member private files through the normal app
- members operate only within their own private namespace

### Storage and upload model

- PostgreSQL stores metadata
- files live on app-managed local disk
- physical storage uses immutable IDs, not logical paths
- logical path is metadata only
- rename and move normally do not move binaries on disk
- uploads stage first, verify checksum, then commit atomically
- no resumable or chunked upload protocol in v1
- practical per-file target is 10 GB
- documented timeout budget is 60 minutes
- staging TTL is 24 hours with worker cleanup

### Sharing and previews

- public share links support files and folders
- share links support expiry, optional password, revoke, and optional download disable
- recipients cannot re-share
- folder shares expose the full linked subtree
- images, PDF, text, audio, and basic video get preview support
- Office docs are metadata or icon only in v1

### Search and restore

- search is filename and path only
- matching is case-insensitive and accent-insensitive
- path segments and extensions contribute to matching
- ranking is exact, then prefix, then substring, then recency tie-breaker
- crash-consistent backup is the minimum guarantee
- coordinated backup is recommended
- restore must be followed by reconciliation

## Current State

The repo already has the foundation scaffold plus completed Phase 1 and Phase 2 work.

### Completed so far

- fresh Turborepo and pnpm workspace
- Next.js web app shell
- worker heartbeat runtime
- Prisma schema baseline
- storage, upload, search, sharing, ownership, restore, and health behavior modules
- health and admin routes
- test coverage for the locked implementation behavior
- signed-in workspace shell with stable routes for `Library`, `Recent`, `Favorites`, `Shared`, `Trash`, and `Settings`
- per-user library roots, nested folder navigation, breadcrumbs, create, rename, move, trash, and restore flows
- authenticated private download, private search, favorites, recents, and bulk trash clear
- route guards, canonical root enforcement, deep-link-preserving sign-in redirects, and normalized unauthenticated JSON errors

### Current active phase

- next focus: Phase 07 Admin and Operational Surface

## Phase Roadmap

## Phase 0: Foundation Scaffold

### Status

Completed

### Goal

Create a fresh repo that encodes the core implementation rules before feature work begins.

### Deliverables

- monorepo scaffold
- web app and worker packages
- environment contract
- Prisma schema baseline
- immutable storage helpers
- upload policy helpers
- search normalization helpers
- sharing policy helpers
- ownership boundary helpers
- admin health summary
- backup and restore documentation

### Exit criteria

- repo installs cleanly
- workspace builds
- core behavior tests pass

## Phase 1: Auth, Bootstrap, and Instance Setup

### Status

Completed

### Goal

Implement the owner and member account model plus the one-time bootstrap flow.

### Scope

- one-time `/setup` flow
- create `Instance`
- create first owner account
- local email and password auth
- opaque database-backed sessions
- sign-in and sign-out
- invite issuance and redemption
- owner-assisted password reset baseline

### Important rules

- `/setup` is disabled after owner creation
- open signup does not exist
- owner-issued invites are the only onboarding path after bootstrap
- session state is server-side, not JWT-first

### Deliverables

- auth server modules
- auth routes
- session cookie flow
- setup page and sign-in page
- invite creation, redeem, revoke, and reissue flows

### Acceptance criteria

- first owner can bootstrap the instance exactly once
- invited member can create an account
- current session can be inspected and revoked locally
- members cannot access admin surfaces

## Phase 2: App Shell and Library Core

### Status

Completed

### Goal

Ship the real signed-in application shell and the first complete private-drive navigation model.

### Scope

- persistent left sidebar
- top-bar search slot
- separate `/admin` area
- `Library`, `Recent`, `Favorites`, `Shared`, `Trash`, and `Settings`
- folder-first explorer layout
- per-user library root
- nested folders
- rename, move, delete, and restore metadata flows

### Important rules

- list view is the default explorer presentation
- grid view is optional, not the default
- admin is not mixed into the normal user workspace
- physical file location remains independent from logical folder paths

### Deliverables

- signed-in shell layout
- breadcrumb navigation
- folder tree and listing pages
- folder CRUD server logic
- library pages and route guards

### Acceptance criteria

- members see only their own private namespace
- move and rename operations preserve internal identity
- owner still cannot browse member private content by default

### Completion notes

- shipped the signed-in workspace shell with stable routes for `Library`, `Recent`, `Favorites`, `Shared`, `Trash`, and `Settings`
- kept `/admin` outside the normal workspace shell
- implemented per-user library roots, nested folder navigation, breadcrumbs, create, rename, move, trash, and restore flows, plus route guards
- hardened Phase 2 with canonical root enforcement, deep-link-preserving sign-in redirects, normalized unauthenticated JSON errors, and additional library-domain coverage

## Phase 3: Upload Pipeline and File Operations

### Goal

Make file ingest feel reliable and product-grade.

### Scope

- staged upload flow
- checksum verification
- atomic commit
- file-size limit enforcement
- timeout guidance surfaced in docs and config
- conflict policy by surface
- file rename, move, trash, restore, and permanent delete

### Important rules

- interactive web upload conflicts prompt the user
- bulk, non-interactive, or API-like uploads safe-rename
- silent overwrite is never the default
- no resumable or chunked upload protocol in v1
- no deduplication in v1
- no quotas in v1

### Deliverables

- upload route and server flow
- staging lifecycle handling
- cleanup job for abandoned staging files
- file CRUD flows

### Acceptance criteria

- checksum mismatch prevents commit
- no committed file appears until verification succeeds
- staging files older than TTL are cleaned by worker job
- move and rename still do not move binaries on disk

## Phase 4: Public Sharing

### Goal

Add secure public-link sharing without drifting into collaboration complexity.

### Scope

- file share links
- folder share links
- password-protected links
- expiry
- revoke and delete
- optional download disable
- shared file view
- shared folder subtree browsing

### Important rules

- recipients can browse the full linked subtree
- recipients cannot re-share
- no user-to-user sharing in v1
- no hidden child filtering in shared subtree mode
- disabling download also disables folder archive download

### Deliverables

- share link creation and management UI
- public share routes
- share access cookie flow
- folder subtree traversal logic

### Acceptance criteria

- public file links and folder links work end-to-end
- expired or revoked links fail safely
- password-gated links require access flow
- download-disabled links block direct downloads and archive downloads

## Phase 5: Search, Favorites, Recents, and Trash

### Status

Completed

### Goal

Complete the everyday retrieval layer that makes the drive feel polished.

### Scope

- filename and path search
- favorites
- recents
- trash listing
- authenticated private file download or open
- restore and clear-trash behavior

### Important rules

- search is case-insensitive and accent-insensitive
- exact beats prefix, prefix beats substring, recency breaks ties
- recents are deduped current-state rows, not an audit log
- private file open is authenticated attachment download in v1
- trash keeps per-file hard delete and one explicit bulk empty-trash action
- full-text search is out of scope
- metadata-advanced search is out of scope

### Deliverables

- search routes and UI
- favorites toggle flows
- recents tracking
- authenticated private file download flow
- trash views and cleanup integration

### Acceptance criteria

- path segments and extensions contribute to search relevance
- search results are deterministic and stable
- trash restore and permanent deletion behave predictably

### Completion notes

- shipped the dedicated retrieval layer for mixed-item search, favorites, and recents
- replaced the disabled search slot with a real `/search` flow and real `/favorites` and `/recent` pages
- added authenticated private file download so recents reflect real file access
- added bulk `Empty trash` while preserving existing per-file permanent delete behavior

## Phase 6: Previews and Worker Jobs

### Status

Completed

### Goal

Use the worker runtime for real product jobs and simplify media access around original-file viewing.

### Scope

- Postgres-backed job execution
- queue claiming and retry behavior
- original-file image and video viewer routes
- trash retention job
- staging-upload cleanup job
- update-check job

### Important rules

- web app creates jobs, worker executes jobs
- worker is the only background executor
- jobs are durable and restart-safe
- images and videos are viewed from original files, not generated derivatives
- PDF, text, and audio remain download-only in this phase

### Deliverables

- real worker job loop
- job status tracking
- original-content media routes with range support for video
- failure and retry handling

### Acceptance criteria

- worker heartbeat and queue backlog are visible in admin health
- queued jobs survive restarts
- image and video viewing works for both private library and public shares
- legacy preview routes degrade cleanly to compatibility redirects or `404`

### Completion notes

- removed preview state from Prisma and deleted legacy `preview.generate` jobs
- replaced preview-derived typing with MIME-derived `viewerKind`
- added dedicated viewer pages and original-content routes for image and video files
- removed FFmpeg, preview generation, preview replay tooling, and preview-specific admin surfaces
- documented that legacy `FILES_ROOT/previews` data can be deleted manually by operators

### Follow-up

- add dedicated viewer models for PDF, text, and audio files

## Phase 7: Admin and Operational Surface

### Goal

Make the instance owner experience feel like part of the product, not an afterthought.

### Scope

- user management
- invite management
- storage usage visibility
- instance health visibility
- update status
- job monitor

### Important rules

- admin health includes DB, storage, worker heartbeat, queue backlog, disk warnings, and version or update status
- admin remains separate from the everyday member workspace
- owner authority is operational, not content-browsing superuser authority

### Deliverables

- `/admin` sections for users, invites, health, jobs, storage summary, and updates
- readiness and health wiring
- operator-facing warning states

### Acceptance criteria

- owner can operate the instance confidently from the app
- members cannot access owner-only surfaces
- operator warnings are clear and actionable

## Phase 8: Restore, Hardening, and Release Quality

### Goal

Raise the product from feature-complete to serious-release quality.

### Scope

- restore reconciliation job
- integrity checks between metadata and originals
- preview regeneration scheduling after restore
- orphan issue reporting
- stronger integration tests
- selective end-to-end tests
- final docs and OSS polish

### Important rules

- restore does not rely on silent best effort
- reconciliation reports issues instead of risky auto-repair
- strong quality gates are required before calling v1 serious

### Deliverables

- restore reconciliation pipeline
- recovery and integrity reporting
- integration and E2E coverage for core flows
- updated install, backup, and upgrade docs

### Acceptance criteria

- known backup and restore scenario can be validated end-to-end
- missing originals and preview gaps are surfaced correctly
- core auth, upload, library, share, search, and admin flows have automated coverage

## Cross-Phase Quality Bar

The implementation should not be considered serious-release ready unless all of these are true:

- design system and shell stay visually consistent
- route boundaries remain explicit
- business logic stays out of React components
- storage and trust guarantees remain intact
- owner and member boundaries are enforced everywhere
- tests cover the critical product promises
- backup and restore behavior is documented and observable

## Explicit Non-Goals

- desktop sync client
- native mobile apps
- S3-compatible storage in v1
- internal user-to-user sharing in v1
- shared workspaces or tenancy in v1
- full-text indexing in v1
- version history in v1
- owner superuser file browsing in v1

## Suggested Execution Order

1. Finish Phase 1 before broad feature work.
2. Complete Phase 2 and Phase 3 as the first true product vertical slice.
3. Add Phase 4 and Phase 5 to make the product genuinely useful.
4. Use Phase 6 and Phase 7 to make the product operationally credible.
5. Use Phase 8 to enforce release quality instead of rushing to "done".
