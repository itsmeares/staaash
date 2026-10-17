import type { FilesActor } from "@/server/files/types";

import { retrievalService } from "./service";
import type { RecentAction } from "./types";

type FileAccessInput = FilesActor & {
  fileId: string;
  action: RecentAction;
};

type FolderAccessInput = FilesActor & {
  folderId: string;
  action: RecentAction;
};

export const recordFileAccessBestEffort = async ({
  actorUserId,
  actorRole,
  fileId,
  action,
}: FileAccessInput): Promise<void> => {
  try {
    await retrievalService.recordFileAccess({
      actorUserId,
      actorRole,
      fileId,
      action,
    });
  } catch (error) {
    console.error("recent-tracking: failed to record file access", {
      action,
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
  action,
}: FolderAccessInput): Promise<void> => {
  try {
    await retrievalService.recordFolderAccess({
      actorUserId,
      actorRole,
      folderId,
      action,
    });
  } catch (error) {
    console.error("recent-tracking: failed to record folder access", {
      action,
      targetKind: "folder",
      targetId: folderId,
      actorUserId,
      error,
    });
  }
};
