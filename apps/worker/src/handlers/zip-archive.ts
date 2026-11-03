import path from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

import { z } from "zod";
import { createZipArchiveStream } from "@staaash/config/zip";
import { readArchiveSelection } from "@staaash/db/archive-selection";
import type { BackgroundJobRecord } from "@staaash/db/jobs";
import {
  StorageAdmissionCancelledError,
  waitForStorageAdmission,
} from "@staaash/db/storage-transactions";
import {
  findZipArchiveById,
  updateZipArchiveProcessing,
  updateZipArchiveFailed,
  ZIP_ARCHIVE_STATUS_READY,
} from "@staaash/db/zip-archives";
import { calculateStorageFileChecksum } from "@staaash/db/storage-mutation-executor";
import { listBlockingStorageMutationsForEntities } from "@staaash/db/storage-mutations";

import type { WorkerStoragePaths } from "../storage-maintenance.js";
import { safeResolveStoragePath } from "../storage-maintenance.js";
import type { JobContext } from "../job-context.js";
import { TerminalJobError } from "../job-context.js";
import {
  assertWorkerMutationMayStart,
  buildArtifactPublishSteps,
  runWorkerStorageMutation,
  StorageMutationOwnedError,
} from "../durable-storage-mutation.js";

type ZipArchiveGeneratePayload = {
  archiveId: string;
};

const zipArchiveIdsSchema = z.object({
  fileIds: z.array(z.string()),
  folderIds: z.array(z.string()),
});

export const handleZipArchiveGenerate = async (
  job: BackgroundJobRecord,
  storagePaths: WorkerStoragePaths,
  context?: JobContext,
): Promise<void> => {
  const payload = job.payloadJson as ZipArchiveGeneratePayload;
  const { archiveId } = payload;

  const archive = await findZipArchiveById(archiveId);
  if (!archive || archive.status === ZIP_ARCHIVE_STATUS_READY) {
    return;
  }

  const parsedIds = zipArchiveIdsSchema.safeParse(archive.idsJson);
  if (!parsedIds.success) {
    throw new TerminalJobError("Invalid zip archive selection.", "payload");
  }

  const idsJson = parsedIds.data;
  const { fileIds, folderIds } = idsJson;
  const userId = archive.userId;
  const publishMutationId = `archive-publish-${archiveId}-${job.id}`;
  if ((await assertWorkerMutationMayStart(publishMutationId)) === "succeeded") {
    return;
  }

  await updateZipArchiveProcessing(archiveId);

  const tmpDir = path.resolve(storagePaths.tmpRoot, "archives");
  await mkdir(tmpDir, { recursive: true });
  const tmpPath = path.resolve(tmpDir, `${archiveId}.zip.tmp`);

  let wroteTemporaryOutput = false;
  try {
    await context?.updateProgress({ stage: "loading_selection", archiveId });

    const selection = await waitForStorageAdmission(
      async () => {
        const selection = await readArchiveSelection(
          userId,
          fileIds,
          folderIds,
        );
        const { filesToZip } = selection;
        const [blockedFiles, blockedFolders] = await Promise.all([
          listBlockingStorageMutationsForEntities({
            entityType: "file",
            entityIds: filesToZip.map((file) => file.id),
          }),
          listBlockingStorageMutationsForEntities({
            entityType: "folder",
            entityIds: selection.allFolders.map((folder) => folder.id),
          }),
        ]);
        const blocked = blockedFiles[0] ?? blockedFolders[0];
        if (blocked) {
          throw new StorageMutationOwnedError(
            blocked.mutation.id,
            new Error("An archive source has an unfinished storage mutation."),
          );
        }
        return selection;
      },
      {
        signal: context?.signal,
        retryable: (error) => error instanceof StorageMutationOwnedError,
      },
    );

    const { allFolders, filesToZip, fileName, directories } = selection;
    const assertContentMatches = (contentKey: string) => {
      // Released jobs have ID-only keys and must still finish after an upgrade.
      if (
        archive.contentKey.startsWith("v2:") &&
        contentKey !== archive.contentKey
      ) {
        throw new TerminalJobError(
          "The selected files changed. Download them again.",
          "archive_selection_changed",
        );
      }
    };
    assertContentMatches(selection.contentKey);
    await context?.updateProgress({
      stage: "writing_archive",
      archiveId,
      fileCount: filesToZip.length,
    });
    const entries = selection.entries.map(({ file, archivePath }) => ({
      filePath: safeResolveStoragePath(storagePaths.filesRoot, file.storageKey),
      archivePath,
    }));

    const output = await createZipArchiveStream(entries, directories);

    // Write zip stream to temp file
    wroteTemporaryOutput = true;
    await pipeline(output, createWriteStream(tmpPath));

    assertContentMatches(
      (await readArchiveSelection(userId, fileIds, folderIds)).contentKey,
    );

    // Move to final location
    const storageKey = `archives/${archiveId}.zip`;
    safeResolveStoragePath(storagePaths.filesRoot, storageKey);
    const { size } = await stat(tmpPath);
    const tmpKey = path
      .relative(storagePaths.filesRoot, tmpPath)
      .split(path.sep)
      .join("/");
    const checksum = await calculateStorageFileChecksum(
      storagePaths.filesRoot,
      tmpKey,
    );
    let oldChecksum: string | null = null;
    try {
      oldChecksum = await calculateStorageFileChecksum(
        storagePaths.filesRoot,
        storageKey,
      );
    } catch {
      oldChecksum = null;
    }
    const readyData = {
      status: "ready",
      storageKey,
      fileName,
      sizeBytes: String(size),
      fileCount: filesToZip.length,
      error: null,
    };
    await runWorkerStorageMutation({
      mutationId: publishMutationId,
      kind: "archive_publish",
      ownerUserId: userId,
      idempotencyKey: `archive-publish:${job.id}`,
      storagePaths,
      signal: context?.signal,
      metadataOperations: [
        {
          action: "update",
          entityType: "archive",
          entityId: archiveId,
          preRevision: archive.storageRevision,
          data: readyData,
        },
      ],
      steps: buildArtifactPublishSteps({
        mutationId: publishMutationId,
        tmpKey,
        storageKey,
        sizeBytes: BigInt(size),
        checksum,
        oldChecksum,
      }),
      entities: [
        ...filesToZip.map((file) => ({
          entityType: "file" as const,
          entityId: file.id,
          preRevision: file.storageRevision,
          postRevision: file.storageRevision,
          beforeJson: null,
          afterJson: null,
        })),
        ...allFolders.map((folder) => ({
          entityType: "folder" as const,
          entityId: folder.id,
          preRevision: folder.storageRevision,
          postRevision: folder.storageRevision,
          beforeJson: null,
          afterJson: null,
        })),
        {
          entityType: "archive",
          entityId: archiveId,
          preRevision: archive.storageRevision,
          postRevision: archive.storageRevision + 1,
          beforeJson: { status: archive.status },
          afterJson: readyData,
        },
      ],
    });
    await context?.updateProgress({ stage: "ready", archiveId });
  } catch (error) {
    if (
      error instanceof StorageMutationOwnedError ||
      error instanceof StorageAdmissionCancelledError
    ) {
      throw error;
    }
    if (wroteTemporaryOutput) await rm(tmpPath, { force: true });
    const message =
      error instanceof Error ? error.message : "Unknown zip error.";
    await updateZipArchiveFailed(archiveId, message);
    throw error;
  }
};
