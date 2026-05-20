-- Track whether a database file row still has its original bytes on disk.
CREATE TYPE "FileStorageStatus" AS ENUM ('available', 'missing');

ALTER TABLE "File"
  ADD COLUMN "storageStatus" "FileStorageStatus" NOT NULL DEFAULT 'available',
  ADD COLUMN "storageCheckedAt" TIMESTAMP(3),
  ADD COLUMN "storageMissingAt" TIMESTAMP(3);

CREATE INDEX "File_ownerUserId_folderId_deletedAt_storageStatus_idx"
  ON "File"("ownerUserId", "folderId", "deletedAt", "storageStatus");
