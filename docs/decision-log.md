# Decision Log

This is the short reference for choices that are intentionally stable during the current rewrite.

Use it when you need to check whether something is already decided before reopening the discussion in code, docs, or planning work.

## Repository Direction

- fresh repo initialized as `staaash`
- previous implementation preserved as `staaash-old`
- this repo is the active implementation target

## Product Scope

- local disk only in v1
- web app only in v1
- Docker and self-hosted only in v1
- public links only for sharing in v1
- no desktop sync client in v1
- no native mobile app in v1
- no internal collaboration permissions in v1
- no multi-tenant workspace model in v1

## Roles And Trust

- roles are `owner` and `member`
- owner manages system and admin concerns
- owner cannot browse member private content through the normal app

## Storage And Search

- PostgreSQL metadata plus app-managed file storage
- immutable ID-based storage layout
- no resumable or chunked upload protocol in v1
- practical per-file target is 10 GB with a 60 minute timeout budget
- search is filename and path only, with normalization and deterministic ranking

## Operational Direction

- admin health is a first-class surface
- backup baseline is crash-consistent backup
- restore requires reconciliation instead of silent best effort

## Phase 6: Preview System (2026-04-04)

- `downloadDisabled` does **not** block previews — only blocks downloads
- preview scheduling is **best-effort**: failures do not roll back successful uploads
- preview jobs use `dedupeKey: "preview:<fileId>"` to prevent pile-up
- preview asset path is `previews/<ownerUserId>/<fileId>/<kind>.<ext>` (via `preview-contract`)
- admin health `/version` block now reads live update-check state from the `Instance` singleton (`readInstanceUpdateCheck`), replacing the old static placeholder
