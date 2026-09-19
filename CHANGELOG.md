# Changelog

This file summarizes stable releases. The linked GitHub release notes contain the full details, upgrade notes, and release artifacts.

## [1.1.1](https://github.com/itsmeares/staaash/releases/tag/v1.1.1) - 2026-09-11

### Fixed

- Direct uploads larger than 10 MB no longer fail.

## [1.1.0](https://github.com/itsmeares/staaash/releases/tag/v1.1.0) - 2026-09-10

### Added

- Upload folders from the folder picker or by drag and drop, including nested files and directories.
- Configurable upload-staging retention from Admin settings or `UPLOAD_STAGING_RETENTION_HOURS`.
- Separate controls for media preview generation during uploads, first views, and sharing.

### Changed

- Resumable uploads now show checksum preparation and verification states.
- Video delivery and media preview generation use less unnecessary work.

### Fixed

- Bootstrap sessions no longer become invalid after a server restart.
- Multipart uploads authenticate before request bodies are read and reject oversized direct uploads earlier.
- Private namespace authorization now applies to media derivatives and archive status metadata.
- Archive polling handles denied access and failed requests more clearly.
- Rename fields place the cursor before file extensions.

## [1.0.4](https://github.com/itsmeares/staaash/releases/tag/v1.0.4) - 2026-09-06

### Fixed

- Concurrent file and folder moves are queued safely.
- Folder navigation and recovery behave better while a move is in progress.
- Staaash now shows a storage-unavailable page when storage operations cannot proceed.

## [1.0.3](https://github.com/itsmeares/staaash/releases/tag/v1.0.3) - 2026-09-05

### Changed

- Resumable upload chunks stream directly to disk instead of being buffered in memory.
- Concurrent chunk writes are coordinated and return a retryable response when a chunk is busy.

### Security

- Updated `fast-uri` to a patched release.

## [1.0.2](https://github.com/itsmeares/staaash/releases/tag/v1.0.2) - 2026-09-02

### Fixed

- Production Docker images now include the SWC helper modules required by the Next.js standalone output.

### Maintenance

- Updated pnpm and `mysql2`.

## [1.0.1](https://github.com/itsmeares/staaash/releases/tag/v1.0.1) - 2026-09-01

### Fixed

- Update-available state no longer remains stale after an upgrade.
- Concurrent storage mutations retry instead of failing unnecessarily.

### Security

- Updated vulnerable transitive dependencies to patched releases.

## [1.0.0](https://github.com/itsmeares/staaash/releases/tag/v1.0.0) - 2026-08-01

The first stable release of Staaash.

### Files and folders

- Upload, create folders, preview, download, rename, move, search, favorite, trash, restore, and permanently delete files.
- Download selected files or folders as generated ZIP archives.

### Uploads and media

- Resume interrupted uploads instead of starting them over.
- Enforce per-user storage quotas and manage temporary upload capacity.
- Generate media previews in the background through the worker.
- View images, audio, video, PDFs, and text files in the browser.

### Sharing and users

- Share files and folders with expiring links, optional passwords, download controls, media previews, and revocation.
- Manage multiple users with owner and admin roles, per-user storage limits, temporary passwords, required password changes, and session controls.

### Operations and recovery

- Monitor health, storage, background jobs, update status, and reconciliation from the admin area.
- Recover interrupted file moves, renames, trash operations, and restores through a durable PostgreSQL mutation journal.

### Deployment

- Run the complete stack with Docker Compose, PostgreSQL 18, and local app-managed storage.
- Support Linux AMD64 containers. Native ARM64 images were not published in this release.
