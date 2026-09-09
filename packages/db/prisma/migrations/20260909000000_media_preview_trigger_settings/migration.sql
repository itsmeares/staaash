ALTER TABLE "SystemSettings"
ADD COLUMN "mediaPreviewGenerateOnFirstView" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "mediaPreviewGenerateOnShare" BOOLEAN NOT NULL DEFAULT true;
