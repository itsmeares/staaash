DELETE FROM "BackgroundJob"
WHERE "kind" = 'preview.generate';

ALTER TABLE "File"
DROP COLUMN "previewStatus";

DROP TYPE IF EXISTS "PreviewStatus";
