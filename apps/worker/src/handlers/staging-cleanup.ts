import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { cleanupExpiredStagingFiles } from "../storage-maintenance.js";
import type { WorkerStoragePaths } from "../storage-maintenance.js";

export const handleStagingCleanup = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
): Promise<void> => {
  await cleanupExpiredStagingFiles({
    tmpRoot: storagePaths.tmpRoot,
    ttlMs: storagePaths.uploadStagingTtlMs,
  });
};
