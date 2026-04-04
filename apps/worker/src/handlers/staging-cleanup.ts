import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { cleanupExpiredStagingFiles } from "../storage-maintenance";
import type { WorkerStoragePaths } from "../storage-maintenance";

export const handleStagingCleanup = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
): Promise<void> => {
  await cleanupExpiredStagingFiles({
    tmpRoot: storagePaths.tmpRoot,
    ttlMs: storagePaths.uploadStagingTtlMs,
  });
};
