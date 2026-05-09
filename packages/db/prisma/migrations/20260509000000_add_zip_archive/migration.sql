-- AlterTable: add zip archive retention to system settings
ALTER TABLE "SystemSettings"
ADD COLUMN "zipArchiveRetentionDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable: zip archive
CREATE TABLE "ZipArchive" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contentKey" TEXT NOT NULL,
    "idsJson" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "storageKey" TEXT,
    "fileName" TEXT,
    "sizeBytes" BIGINT,
    "fileCount" INTEGER,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZipArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ZipArchive_contentKey_key" ON "ZipArchive"("contentKey");

-- CreateIndex
CREATE UNIQUE INDEX "ZipArchive_storageKey_key" ON "ZipArchive"("storageKey");

-- CreateIndex
CREATE INDEX "ZipArchive_status_idx" ON "ZipArchive"("status");

-- CreateIndex
CREATE INDEX "ZipArchive_expiresAt_idx" ON "ZipArchive"("expiresAt");

-- AddForeignKey
ALTER TABLE "ZipArchive" ADD CONSTRAINT "ZipArchive_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
