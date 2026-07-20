import type { BackgroundJobRecord } from "@staaash/db/jobs";
import { getPrisma } from "@staaash/db/client";
import { cleanupExpiredStagingFiles } from "../storage-maintenance.js";
import type { WorkerStoragePaths } from "../storage-maintenance.js";

const ACTIVE_RESUMABLE_SESSION_STATUSES = ["created", "receiving"];

type ResumableSessionPathClient = {
  uploadSession: {
    findMany(args: {
      where: {
        status: { in: string[] };
        expiresAt: { gt: Date };
      };
      select: { tmpPath: true };
    }): Promise<Array<{ tmpPath: string }>>;
  };
};

const findProtectedResumableUploadPaths = async ({
  client,
  now,
}: {
  client: ResumableSessionPathClient;
  now: Date;
}) => {
  const sessions = await client.uploadSession.findMany({
    where: {
      status: { in: ACTIVE_RESUMABLE_SESSION_STATUSES },
      expiresAt: { gt: now },
    },
    select: { tmpPath: true },
  });

  return sessions.map((session) => session.tmpPath);
};

export const handleStagingCleanup = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
): Promise<void> => {
  const now = new Date();
  const protectedPaths = await findProtectedResumableUploadPaths({
    client: getPrisma() as unknown as ResumableSessionPathClient,
    now,
  });

  await cleanupExpiredStagingFiles({
    tmpRoot: storagePaths.tmpRoot,
    ttlMs: storagePaths.uploadStagingTtlMs,
    protectedPaths,
    now,
  });
};
