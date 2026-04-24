import { canAccessPrivateNamespace } from "@/server/access";
import { prismaFilesRepository } from "@/server/files/repository";
import type { FilesActor, StoredFile } from "@/server/files/types";

import { FilesError } from "./errors";

export const getAccessiblePrivateFile = async ({
  actorRole,
  actorUserId,
  fileId,
}: FilesActor & {
  fileId: string;
}): Promise<StoredFile> => {
  const file = await prismaFilesRepository.findFileById(fileId);

  if (!file || file.deletedAt) {
    throw new FilesError("FILE_NOT_FOUND");
  }

  if (
    !canAccessPrivateNamespace({
      actorRole,
      actorUserId,
      namespaceOwnerUserId: file.ownerUserId,
    })
  ) {
    throw new FilesError("ACCESS_DENIED");
  }

  return file;
};
