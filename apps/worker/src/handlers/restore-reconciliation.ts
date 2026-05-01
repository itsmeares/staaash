import path from "node:path";
import { access, constants, readdir } from "node:fs/promises";

import { getPrisma } from "@staaash/db/client";
import {
  completeRestoreReconciliationRun,
  createRestoreReconciliationRun,
  findRestoreReconciliationRunByBackgroundJobId,
  markRestoreReconciliationRunRunning,
  type RestoreReconciliationIssueDetails,
} from "@staaash/db/reconciliation";
import type { BackgroundJobRecord } from "@staaash/db/jobs";

import type { WorkerStoragePaths } from "../storage-maintenance.js";

type ReconciliationFileRecord = {
  id: string;
  storageKey: string;
};

type ReconciliationClient = {
  file: {
    findMany(args: object): Promise<ReconciliationFileRecord[]>;
  };
};

const toStorageKey = (filesRoot: string, absolutePath: string) =>
  path.relative(filesRoot, absolutePath).split(path.sep).join(path.posix.sep);

const readTriggeredByUserId = (payloadJson: unknown) => {
  if (!payloadJson || typeof payloadJson !== "object") {
    return null;
  }

  const triggeredByUserId = (payloadJson as { triggeredByUserId?: unknown })
    .triggeredByUserId;

  return typeof triggeredByUserId === "string" ? triggeredByUserId : null;
};

const pathExists = async (absolutePath: string) => {
  try {
    await access(absolutePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const walkCommittedStorageTree = async (
  absoluteRoot: string,
  filesRoot: string,
): Promise<string[]> => {
  try {
    const entries = await readdir(absoluteRoot, {
      withFileTypes: true,
    });
    const storageKeys: string[] = [];

    for (const entry of entries) {
      const absolutePath = path.join(absoluteRoot, entry.name);

      if (entry.isDirectory()) {
        storageKeys.push(
          ...(await walkCommittedStorageTree(absolutePath, filesRoot)),
        );
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      storageKeys.push(toStorageKey(filesRoot, absolutePath));
    }

    return storageKeys;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

export const collectMissingOriginals = async (
  fileRecords: ReconciliationFileRecord[],
  filesRoot: string,
): Promise<RestoreReconciliationIssueDetails["missingOriginals"]> => {
  const missingOriginals: RestoreReconciliationIssueDetails["missingOriginals"] =
    [];

  for (const file of fileRecords) {
    const originalExists = await pathExists(
      path.resolve(filesRoot, file.storageKey),
    );

    if (!originalExists) {
      missingOriginals.push({
        fileId: file.id,
        storageKey: file.storageKey,
      });
    }
  }

  return missingOriginals;
};

export const collectOrphanedStorageKeys = async ({
  filesRoot,
  knownStorageKeys,
}: {
  filesRoot: string;
  knownStorageKeys: Set<string>;
}): Promise<string[]> => {
  const committedStorageKeys = [
    ...(await walkCommittedStorageTree(
      path.resolve(filesRoot, "library"),
      filesRoot,
    )),
    ...(await walkCommittedStorageTree(
      path.resolve(filesRoot, ".trash"),
      filesRoot,
    )),
  ];

  return committedStorageKeys.filter(
    (storageKey) => !knownStorageKeys.has(storageKey),
  );
};

export const collectRestoreReconciliationIssues = async ({
  filesRoot,
  fileRecords,
}: {
  filesRoot: string;
  fileRecords: ReconciliationFileRecord[];
}): Promise<RestoreReconciliationIssueDetails> => {
  const knownStorageKeys = new Set(fileRecords.map((file) => file.storageKey));
  const [missingOriginals, orphanedStorageKeys] = await Promise.all([
    collectMissingOriginals(fileRecords, filesRoot),
    collectOrphanedStorageKeys({
      filesRoot,
      knownStorageKeys,
    }),
  ]);

  return {
    missingOriginals,
    orphanedStorageKeys,
  };
};

/**
 * Runs the manual restore-reconciliation audit.
 *
 * The worker checks DB-tracked originals for missing blobs and scans the
 * committed storage namespaces for files that do not map back to metadata.
 * It intentionally ignores transient tmp infrastructure by only walking the
 * committed `library/` and `.trash/` trees.
 */
export const handleRestoreReconciliation = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
  client?: ReconciliationClient,
): Promise<void> => {
  const activeClient =
    client ?? (getPrisma() as unknown as ReconciliationClient);
  const triggeredByUserId = readTriggeredByUserId(job.payloadJson);
  const existingRun = await findRestoreReconciliationRunByBackgroundJobId(
    job.id,
  );

  if (!existingRun) {
    await createRestoreReconciliationRun({
      triggeredByUserId,
      backgroundJobId: job.id,
    });
  }

  await markRestoreReconciliationRunRunning({
    backgroundJobId: job.id,
  });

  const fileRecords = await activeClient.file.findMany({
    select: {
      id: true,
      storageKey: true,
    },
  });

  const details = await collectRestoreReconciliationIssues({
    filesRoot: storagePaths.filesRoot,
    fileRecords,
  });

  await completeRestoreReconciliationRun({
    backgroundJobId: job.id,
    details,
  });
};
