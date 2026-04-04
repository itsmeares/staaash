import { canAccessPrivateNamespace } from "@/server/access";
import { prismaLibraryRepository } from "@/server/library/repository";
import type { LibraryActor, StoredLibraryFile } from "@/server/library/types";

import { LibraryError } from "./errors";

export const getAccessiblePrivateFile = async ({
  actorRole,
  actorUserId,
  fileId,
}: LibraryActor & {
  fileId: string;
}): Promise<StoredLibraryFile> => {
  const file = await prismaLibraryRepository.findFileById(fileId);

  if (!file || file.deletedAt) {
    throw new LibraryError("FILE_NOT_FOUND");
  }

  if (
    !canAccessPrivateNamespace({
      actorRole,
      actorUserId,
      namespaceOwnerUserId: file.ownerUserId,
    })
  ) {
    throw new LibraryError("ACCESS_DENIED");
  }

  return file;
};
