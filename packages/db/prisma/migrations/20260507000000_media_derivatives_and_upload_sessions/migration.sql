-- AlterTable
ALTER TABLE "SystemSettings"
ADD COLUMN "mediaPreviewEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "mediaPreviewGenerateOnUpload" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "mediaPreviewThresholdBytes" BIGINT NOT NULL DEFAULT 367001600,
ADD COLUMN "mediaPreviewRetentionDays" INTEGER NOT NULL DEFAULT 14,
ADD COLUMN "mediaPreviewMaxHeight" INTEGER NOT NULL DEFAULT 1080,
ADD COLUMN "mediaPreviewCrf" INTEGER NOT NULL DEFAULT 22,
ADD COLUMN "mediaPreviewMaxConcurrentJobs" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "MediaDerivative" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "profile" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSeconds" DOUBLE PRECISION,
    "videoCodec" TEXT,
    "audioCodec" TEXT,
    "error" TEXT,
    "pinnedByAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastViewedAt" TIMESTAMP(3),
    "lastSharedAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaDerivative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadSession" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "folderId" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "totalSizeBytes" BIGINT NOT NULL,
    "receivedBytes" BIGINT NOT NULL DEFAULT 0,
    "expectedChecksum" TEXT,
    "tmpPath" TEXT NOT NULL,
    "conflictStrategy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaDerivative_storageKey_key" ON "MediaDerivative"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaDerivative_fileId_kind_profile_key" ON "MediaDerivative"("fileId", "kind", "profile");

-- CreateIndex
CREATE INDEX "MediaDerivative_status_updatedAt_idx" ON "MediaDerivative"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "MediaDerivative_pinnedByAdmin_lastViewedAt_idx" ON "MediaDerivative"("pinnedByAdmin", "lastViewedAt");

-- CreateIndex
CREATE INDEX "UploadSession_ownerUserId_status_idx" ON "UploadSession"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "UploadSession_expiresAt_status_idx" ON "UploadSession"("expiresAt", "status");

-- AddForeignKey
ALTER TABLE "MediaDerivative" ADD CONSTRAINT "MediaDerivative_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;
