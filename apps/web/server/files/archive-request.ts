import { scheduleZipArchiveGenerate } from "@staaash/db/jobs";
import {
  buildZipContentKey,
  findOrCreateZipArchive,
  ZIP_ARCHIVE_STATUS_FAILED,
} from "@staaash/db/zip-archives";

import { canAccessPrivateNamespace } from "@/server/access";
import { FilesError } from "@/server/files/errors";
import { getReadableArchiveStatus } from "@/server/files/archive-status";
import { findArchiveSelectionItems } from "@/server/files/repository";
import type { FilesActor } from "@/server/files/types";
import { getSystemSettings } from "@/server/settings";

const ZIP_ARCHIVE_RETENTION_DEFAULT_DAYS = 7;

/** Finds or queues the zip for a selection; the same selection reuses one archive. */
export const requestArchive = async (actor: FilesActor, ids: string[]) => {
  const fileIds: string[] = [];
  const folderIds: string[] = [];
  let sourceSizeBytes = 0n;

  const { files, folders } = await findArchiveSelectionItems(ids);
  const filesById = new Map(files.map((file) => [file.id, file]));
  const foldersById = new Map(folders.map((folder) => [folder.id, folder]));

  for (const id of ids) {
    const file = filesById.get(id);
    const folder = foldersById.get(id);

    if (file && !file.deletedAt) {
      if (
        !canAccessPrivateNamespace({
          actorRole: actor.actorRole,
          actorUserId: actor.actorUserId,
          namespaceOwnerUserId: file.ownerUserId,
        })
      ) {
        throw new FilesError("ACCESS_DENIED");
      }
      fileIds.push(id);
      sourceSizeBytes += file.sizeBytes;
    } else if (folder && !folder.deletedAt) {
      if (
        !canAccessPrivateNamespace({
          actorRole: actor.actorRole,
          actorUserId: actor.actorUserId,
          namespaceOwnerUserId: folder.ownerUserId,
        })
      ) {
        throw new FilesError("ACCESS_DENIED");
      }
      folderIds.push(id);
    } else {
      throw new FilesError("FILE_NOT_FOUND");
    }
  }

  const settings = await getSystemSettings();
  const retentionDays =
    settings.zipArchiveRetentionDays ?? ZIP_ARCHIVE_RETENTION_DEFAULT_DAYS;
  const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

  const contentKey = buildZipContentKey(fileIds, folderIds);
  const { archive, created } = await findOrCreateZipArchive({
    userId: actor.actorUserId,
    contentKey,
    idsJson: { fileIds, folderIds },
    expiresAt,
  });

  if (created || archive.status === ZIP_ARCHIVE_STATUS_FAILED) {
    await scheduleZipArchiveGenerate({
      archiveId: archive.id,
      sourceSizeBytes,
      fileCount: fileIds.length,
      folderCount: folderIds.length,
    });
  }

  return {
    archiveId: archive.id,
    status:
      archive.status === ZIP_ARCHIVE_STATUS_FAILED
        ? ("queued" as const)
        : await getReadableArchiveStatus(archive),
  };
};
