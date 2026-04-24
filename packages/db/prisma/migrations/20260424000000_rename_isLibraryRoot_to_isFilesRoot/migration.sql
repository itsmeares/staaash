-- AlterTable
ALTER TABLE "Folder" RENAME COLUMN "isLibraryRoot" TO "isFilesRoot";

-- RenameIndex
ALTER INDEX "Folder_ownerUserId_isLibraryRoot_idx" RENAME TO "Folder_ownerUserId_isFilesRoot_idx";
