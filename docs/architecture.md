# Architecture

## System Shape

Staaash is a modular monolith with a separate worker runtime for background behavior.

The web app handles the interactive product surface, request-time business logic, and owner-facing operational views. The worker handles durable background work that should not depend on a request staying open.

This is intentionally a small, explicit architecture. The repo is trying to make storage and recovery behavior reliable before it tries to look more distributed than it needs to be.

## Main Runtimes

### Web app

- Next.js App Router application
- signed-in workspace shell and server routes
- auth, files, sharing, search, restore, and admin-facing request flows

### Worker

- separate runtime for background behavior
- intended home for cleanup, reconciliation, and other queued work
- operationally visible through admin health surfaces

### PostgreSQL

- system of record for metadata
- stores users, auth/session state, file and folder metadata, sharing state, and other durable app records

### File storage volume

- app-managed local disk
- stores original binaries outside logical folder layout
- uses immutable IDs instead of user-visible paths for physical placement

## Core Data And Storage Model

- PostgreSQL stores metadata
- physical files live on an app-managed local volume
- logical paths exist in metadata only
- rename and move operations normally do not move binaries on disk
- uploads stage under `FILES_ROOT/tmp/` before verification and commit

This separation is one of the main architectural choices in the repo. It keeps logical organization flexible without making physical storage behavior hard to reason about.

## Locked Behavior Rules

- physical storage uses immutable IDs, not logical paths
- uploads stage first, then verify checksum, then commit atomically
- share links bind to files or folders by stable IDs
- search is case-insensitive, accent-insensitive, and path-token aware
- `/admin` health includes DB reachability, storage writability, worker heartbeat, queue backlog, disk warnings, and version or update status
- restore requires reconciliation instead of silent best effort
- preview-capable media is viewed from original bytes; restore does not regenerate derivative previews

## Boundaries And Non-Goals

- no microservice split in v1
- no desktop sync client in v1
- no native mobile app in v1
- no S3-compatible storage backend in v1
- no internal collaboration permissions or shared workspaces in v1
- owner authority is operational, not a normal-app superuser bypass for member private content

## Related Docs

- [`implementation-plan.md`](./implementation-plan.md) for the phased roadmap
- [`decision-log.md`](./decision-log.md) for stable product and architecture choices
- [`operations/backup-restore.md`](./operations/backup-restore.md) for backup and restore expectations
