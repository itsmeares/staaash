import {
  getStorageMutationStateMap,
  StorageEntityUnavailableError,
} from "@/server/storage-read-guard";
import { readArchiveSelection } from "@staaash/db/archive-selection";
import { findOrCreateZipArchive } from "@staaash/db/zip-archives";

import { canAccessPrivateNamespace } from "@/server/access";
import { FilesError } from "@/server/files/errors";
import { getReadableArchiveStatus } from "@/server/files/archive-status";
import { findArchiveSelectionItems } from "@/server/files/repository";
import type { FilesActor } from "@/server/files/types";
import { getSystemSettings } from "@/server/settings";

const ZIP_ARCHIVE_RETENTION_DEFAULT_DAYS = 7;

// fallow-ignore-next-line complexity
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
        throw new FilesError("FILE_NOT_FOUND");
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
        throw new FilesError("FILE_NOT_FOUND");
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

  const { contentKey, filesToZip, allFolders } = await readArchiveSelection(
    actor.actorUserId,
    fileIds,
    folderIds,
  );
  const [fileStates, folderStates] = await Promise.all([
    getStorageMutationStateMap(
      "file",
      filesToZip.map((file) => file.id),
    ),
    getStorageMutationStateMap(
      "folder",
      allFolders.map((folder) => folder.id),
    ),
  ]);
  const blocked =
    fileStates.values().next().value ?? folderStates.values().next().value;
  if (blocked) throw new StorageEntityUnavailableError(blocked);
  const { archive } = await findOrCreateZipArchive({
    userId: actor.actorUserId,
    contentKey,
    idsJson: { fileIds, folderIds },
    expiresAt,
    sourceSizeBytes,
  });

  return {
    archiveId: archive.id,
    status: await getReadableArchiveStatus(archive),
  };
};
