-- Previews rebuild from the original when someone views them, so admins no
-- longer keep one past its cleanup time.
DROP INDEX "MediaDerivative_pinnedByAdmin_lastViewedAt_idx";

-- AlterTable
ALTER TABLE "MediaDerivative" DROP COLUMN "pinnedByAdmin";
