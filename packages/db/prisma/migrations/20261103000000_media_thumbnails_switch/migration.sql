-- Thumbnails get their own switch, on for every drive: v1 had no thumbnails,
-- so an old "Media previews" choice only ever meant video copies.
ALTER TABLE "SystemSettings"
ADD COLUMN "mediaThumbnailsEnabled" BOOLEAN NOT NULL DEFAULT true,
DROP COLUMN "mediaPreviewMaxConcurrentJobs";
