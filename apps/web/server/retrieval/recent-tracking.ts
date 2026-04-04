import type { LibraryActor } from "@/server/library/types";

import { retrievalService } from "./service";

type FileAccessInput = LibraryActor & {
  fileId: string;
  source: string;
};

type FolderAccessInput = LibraryActor & {
  folderId: string;
  source: string;
};

export const recordFileAccessBestEffort = async ({
  actorUserId,
  actorRole,
  fileId,
  source,
}: FileAccessInput): Promise<void> => {
  try {
    await retrievalService.recordFileAccess({
      actorUserId,
      actorRole,
      fileId,
    });
  } catch (error) {
    console.error("recent-tracking: failed to record file access", {
      source,
      targetKind: "file",
      targetId: fileId,
      actorUserId,
      error,
    });
  }
};

export const recordFolderAccessBestEffort = async ({
  actorUserId,
  actorRole,
  folderId,
  source,
}: FolderAccessInput): Promise<void> => {
  try {
    await retrievalService.recordFolderAccess({
      actorUserId,
      actorRole,
      folderId,
    });
  } catch (error) {
    console.error("recent-tracking: failed to record folder access", {
      source,
      targetKind: "folder",
      targetId: folderId,
      actorUserId,
      error,
    });
  }
};
