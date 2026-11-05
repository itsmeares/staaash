-- Nothing ever read these. The text viewer has its own fixed cap now.
ALTER TABLE "SystemSettings"
DROP COLUMN "previewMaxSourceBytes",
DROP COLUMN "previewTextMaxBytes";
