-- AlterTable
ALTER TABLE "StorageMutation" ADD COLUMN "reviewJson" JSONB,
ADD COLUMN "reviewedAt" TIMESTAMP(3),
ADD COLUMN "reviewNoticeSeenAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "StorageMutation_reviewedAt_idx" ON "StorageMutation"("reviewedAt");

-- Review fixes move leftovers aside and remove empty leftover folders.
ALTER TABLE "StorageMutationStep" DROP CONSTRAINT "StorageMutationStep_action_check";
ALTER TABLE "StorageMutationStep" ADD CONSTRAINT "StorageMutationStep_action_check"
CHECK ("action" IN ('mkdir', 'rename', 'delete_file', 'delete_tree', 'remove_empty_directory', 'set_aside', 'remove_empty_tree'));
