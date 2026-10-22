import { open } from "node:fs/promises";

import { canAccessPrivateNamespace } from "@/server/access";
import { createRangeResponseFromHandle } from "@/server/downloads/range-response";
import { FilesError } from "@/server/files/errors";
import { prismaFilesRepository } from "@/server/files/repository";
import type { Session } from "@/server/http/core";
import { recordFileAccessBestEffort } from "@/server/retrieval/recent-tracking";
import { getStoragePath } from "@/server/storage";
import { assertStorageEntityReadable } from "@/server/storage-read-guard";

const isFileUnreadable = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "EACCES" || code === "EISDIR";
};

const isMissingStorageObject = (error: unknown) => {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "EISDIR";
};

/** Streams one of the signed-in user's files as an attachment, with Range support. */
export const downloadPrivateFile = async ({
  request,
  session,
  fileId,
}: {
  request: Request;
  session: Session;
  fileId: string;
}) => {
  const file = await prismaFilesRepository.findFileById(fileId);

  if (!file || file.deletedAt) {
    throw new FilesError("FILE_NOT_FOUND");
  }

  if (
    !canAccessPrivateNamespace({
      actorRole: session.user.role,
      actorUserId: session.user.id,
      namespaceOwnerUserId: file.ownerUserId,
    })
  ) {
    throw new FilesError("ACCESS_DENIED");
  }

  const storagePath = getStoragePath(file.storageKey);
  await assertStorageEntityReadable("file", file.id);

  // Open explicitly so the file is proven readable before recording recents.
  let fileHandle;

  try {
    fileHandle = await open(storagePath, "r");
  } catch (openError) {
    if (isMissingStorageObject(openError)) {
      await prismaFilesRepository.markFileStorageMissing(file.id);
    }

    if (isFileUnreadable(openError)) {
      throw new FilesError("FILE_NOT_FOUND");
    }
    throw openError;
  }

  // File is readable — record recents best-effort before streaming.
  await recordFileAccessBestEffort({
    actorUserId: session.user.id,
    actorRole: session.user.role,
    fileId: file.id,
    action: "downloaded",
  });

  return createRangeResponseFromHandle(
    request,
    fileHandle,
    file.sizeBytes,
    file.mimeType || "application/octet-stream",
    file.name,
  );
};
