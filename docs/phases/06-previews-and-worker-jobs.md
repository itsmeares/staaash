# Phase 06: Previews and Worker Jobs

## Status

Completed on 2026-04-04.

## Outcome

Phase 6 shipped the worker cleanup and media-viewing simplification that replaced the original generated-preview direction.

- images and videos now open on dedicated viewer pages
- original image bytes are served inline
- original video bytes are streamed inline with HTTP range support
- public shares follow the same viewer behavior as private library files
- `downloadDisabled` still blocks explicit downloads but does not block image or video viewing
- PDF, text, and audio remain download-only in this phase
- preview generation, FFmpeg, preview replay tooling, and preview-specific admin surfaces were removed

## Dependencies

- Phase 03 complete
- Phase 04 and Phase 05 can proceed in parallel, but worker infrastructure must be stable before they depend on it heavily

## Delivered Work

- Removed preview state from Prisma and deleted legacy `preview.generate` jobs in migration.
- Replaced preview-derived file typing with MIME-derived `viewerKind`.
- Added private and public original-content routes, including single-range video support.
- Added dedicated private and public viewer pages for image and video files.
- Removed preview scheduling from upload and replace flows.
- Kept the worker focused on the remaining durable job kinds instead of preview generation.
- Removed FFmpeg-specific runtime diagnostics and preview operator controls.

## Validation

- Verify image and video viewer routes work for private library and public shares.
- Verify unsupported viewer types return `404` on viewer and content routes.
- Verify invalid video range requests return `416`.
- Run `pnpm test`, `pnpm lint`, and `pnpm build`.

## Follow-Up

- The remaining viewer follow-up is adding dedicated viewer models for PDF, text, and audio files.
