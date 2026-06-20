# Product

## Register

product

## Users

Staaash is for self-hosters, privacy-minded people, and open-source home-server users who want a dependable file drive on storage they control. The expected baseline is still Docker/self-hosting, but the product should be clear enough for people who do not enjoy debugging infrastructure.

The main audience is broader than the maintainer now: solo users, households, families, friend groups, and small trusted circles. They use Staaash for ordinary file work: upload, browse, search, share, favorite, recover from trash, and check that the instance is healthy.

There are two user contexts:

- Workspace users manage their own files, folders, favorites, recent items, trash, preferences, and shared links.
- Owners also manage the instance: invites, storage state, worker jobs, update checks, restore reconciliation, health, and beta upgrade risk.

Owner authority is operational. It should not make the owner a normal-app superuser who can casually browse member private files.

## Product Purpose

Staaash is an open-source, self-hosted file drive for people and small trusted groups who want a dependable alternative to handing personal files to a commercial cloud.

The product is in beta, moving toward release candidate. Success means the core trust loop works: install, upload, organize, share, back up, restore, upgrade, and understand system health when something goes wrong.

It should feel almost release-ready: clear to install, safe to upgrade, honest about beta risk, and usable by someone beyond the maintainer.

## Brand Personality

Voice: plain, honest, practical.

Personality: calm, dependable, self-owned.

Staaash should feel like a well-made home tool, not a SaaS dashboard. It can have personality through the name, icon, and small product details, but the interface should stay quiet enough that files, folders, media, jobs, and warnings remain the focus.

Public-facing copy should be simple and direct. Avoid hype, enterprise language, and vague confidence claims. When the product is beta or risky, say that plainly.

## Anti-references

Staaash should not feel like:

- Nextcloud Files at its worst: crowded, gray, chrome-heavy, and hard to scan.
- A generic SaaS productivity dashboard with marketing polish where operational clarity is needed.
- A consumer cloud service that hides ownership, storage, backup, or restore details behind vague status text.
- A homelab tool that treats confusing setup, vague errors, or missing recovery guidance as acceptable because the user is technical.
- A feature-bloated platform trying to support every deployment, storage backend, client, and collaboration model before the basic home-server path is trustworthy.

## Design Principles

### Trust Before Features

Prioritize proof that core file and recovery behavior works. Backup, restore, upgrade, admin health, missing-storage handling, and worker visibility are product features, not maintenance chores.

### Open-Source, But Owned

Design for a real public audience while keeping the product small enough for one maintainer and self-hosters to understand. Public users benefit most when the app is clear, stable, and honest about tradeoffs.

### The Interface Serves The Files

Files, folders, previews, shares, and operational state are the content. UI chrome should support scanning, selection, movement, upload, recovery, and sharing without competing for attention.

### Operational Clarity Is Part Of The Product

Owners need honest status: database, file volume, worker heartbeat, queue backlog, disk warnings, updates, restore reconciliation, and beta upgrade caveats. Do not hide uncertainty behind green-looking summaries.

Use status color consistently across admin and workspace operations: green for succeeded or healthy, blue for running, amber for queued or warning, red for failed or blocked, and neutral for cancelled, idle, or stopped. The same semantic status token should drive dots, text, chips, and badges so operational state never looks arbitrary.

### Small Architecture, Clear Boundaries

Keep the v1 shape focused: web app, worker, PostgreSQL metadata, and local file storage. Treat microservices, desktop sync, native mobile, S3-compatible storage, and complex collaboration permissions as post-v1 work unless a clear product decision changes that.

### Safe File Actions

Upload, move, rename, trash, restore, delete, download, archive, and share flows must make state and consequences clear. Dangerous or irreversible actions need plain wording and recoverability where possible.

### Mobile Is A Real Surface

Mobile and tablet support should keep the same product model as desktop. Navigation, upload, selection, action sheets, sharing, and recovery flows should work cleanly on coarse pointers without becoming a separate reduced product.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Keep keyboard navigation, visible focus states, readable contrast, clear form labels, reduced-motion support, and 200% zoom behavior as product requirements.

Use plain language for setup, beta warnings, backup/restore, invites, sharing, admin health, and destructive actions. The app is for self-hosters, but the UI should not require developer fluency.

Support privacy expectations by keeping member namespaces distinct, owner admin actions explicit, and public share states easy to understand.
