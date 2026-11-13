# Changelog

See linked GitHub release notes for full details.

## [2.0.0](https://github.com/itsmeares/staaash/releases/tag/v2.0.0)

Staaash 2.0 adds a desktop app that syncs folders, a new design for every screen, and a new web engine.

### ⚠️ Upgrade notes

- Back up your database and files together before upgrading. This release runs 18 database migrations, and four of them remove columns or tables. Going back to 1.x means restoring that backup.
- `docker-compose.yml` and `example.env` changed. Download both from this release. Migrations now run in their own `migrate` service before the server and worker start.
- Another member's private file, folder, zip or share now answers 404 instead of 403.
- `/api/auth/session` no longer returns `deviceSessionId`.
- Upload session limits are fixed at 32 per user and 128 per server, and their admin settings are gone. Two preview size settings and the video preview concurrency setting are gone too.

### ✨ New features

- **Desktop app.** Sync folders between your computer and your drive on Windows, macOS and Linux. Choose two-way, download only or upload only, leave out subfolders, and see speed and time left. Conflicting versions are both kept, and deletes go to the trash on both sides.
- **New design.** The drive, admin, settings and sign-in are rebuilt, in light and dark, on desktop and phone. Every page uses one list with list and grid views, and phones get a bottom bar and a swiping viewer.
- **New engine.** A Vite app on a Hono server replaces Next.js. The public API is described in `openapi.json` and only gains routes and fields within 2.x.
- **Windows server.** Run Staaash on Windows 10, 11 or Server 2019 and newer without Docker. The installer sets up the web app, worker and PostgreSQL as Windows services.
- **HTTPS.** An optional Caddy setup gets a certificate for your own domain.
- **Demo.** [Try Staaash](https://itsmeares.github.io/staaash/) in your browser before installing.
- One transfers menu for uploads, zips and downloads, with speed and time left.
- Paste a screenshot or copied file into a folder to upload it.
- Move with a folder picker, and undo the move.
- Folder links show photos as a gallery.
- Sign out your other devices from Settings.
- Empty a large trash in the background, and change folders with thousands of items reliably.
- The owner can turn thumbnails and smaller video copies on and off separately.

### 🔒 Security

- Private HTML and SVG files no longer run scripts when opened.

## [1.2.1](https://github.com/itsmeares/staaash/releases/tag/v1.2.1) - 2026-10-23

### Security

- Updated Node to 24.22.1 to reject certificate keys affected by the eMudhra certificate compromise and include other upstream security fixes.

## [1.2.0](https://github.com/itsmeares/staaash/releases/tag/v1.2.0) - 2026-10-06

This release applies two database migrations at startup. Back up the database and uploaded files together before upgrading.

### Added

- Native Linux ARM64 container images alongside AMD64.

### Changed

- Refreshed the workspace, admin, authentication, onboarding, and public sharing interfaces with shared components and consistent themes.
- File Properties now opens beside the file list.
- Dates now render in the viewer's time zone.

### Fixed

- Impossible storage operations and over-quota direct uploads no longer leave accounts blocked by unfinished mutations.
- Cancelled media preview jobs settle correctly, older generation attempts cannot overwrite newer ones, and previews respect the maximum height setting.
- Archive status polling stops on rejected responses.
- Browser-generated client IDs work on plain HTTP deployments.
- Text remains readable across surfaces in both themes.
- Date rendering no longer causes hydration errors when browser and server time zones differ.

### Maintenance

- Updated dependencies and tooling, refreshed documentation, and added ARM64 smoke tests and UI regression coverage.

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
