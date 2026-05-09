import { NextRequest } from "next/server";

import {
  findZipArchiveById,
  ZIP_ARCHIVE_STATUS_READY,
} from "@staaash/db/zip-archives";

import { canAccessPrivateNamespace } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import { notSignedInResponse, jsonErrorResponse } from "@/server/auth/http";
import { FilesError } from "@/server/files/errors";
import { prismaFilesRepository } from "@/server/files/repository";
import { getStoragePath } from "@/server/storage";
import { createRangeResponseFromPath } from "@/server/downloads/range-response";

type RouteContext = {
  params: Promise<{ archiveId: string }>;
};

export async function GET(
  request: NextRequest,
  { params }: RouteContext,
): Promise<Response> {
  const { archiveId } = await params;
  const session = await getRequestSession(request);
  if (!session) {
    return notSignedInResponse(
      request,
      `/api/files/archives/${archiveId}/download`,
    );
  }

  try {
    const archive = await findZipArchiveById(archiveId);
    if (
      !archive ||
      archive.status !== ZIP_ARCHIVE_STATUS_READY ||
      !archive.storageKey
    ) {
      throw new FilesError("FILE_NOT_FOUND");
    }

    // Re-verify access: check first item in idsJson still accessible
    const idsJson = archive.idsJson as {
      fileIds: string[];
      folderIds: string[];
    };
    const firstFileId = idsJson.fileIds[0];
    const firstFolderId = idsJson.folderIds[0];

    if (firstFileId) {
      const file = await prismaFilesRepository.findFileById(firstFileId);
      if (
        !file ||
        !canAccessPrivateNamespace({
          actorRole: session.user.role,
          actorUserId: session.user.id,
          namespaceOwnerUserId: file.ownerUserId,
        })
      ) {
        throw new FilesError("ACCESS_DENIED");
      }
    } else if (firstFolderId) {
      const folder = await prismaFilesRepository.findFolderById(firstFolderId);
      if (
        !folder ||
        !canAccessPrivateNamespace({
          actorRole: session.user.role,
          actorUserId: session.user.id,
          namespaceOwnerUserId: folder.ownerUserId,
        })
      ) {
        throw new FilesError("ACCESS_DENIED");
      }
    }

    const storagePath = getStoragePath(archive.storageKey);
    const sizeBytes = Number(archive.sizeBytes ?? 0);
    const fileName = archive.fileName ?? "staaash-files.zip";

    const response = await createRangeResponseFromPath(
      request,
      storagePath,
      sizeBytes,
      "application/zip",
      fileName,
    );

    if (!response) {
      throw new FilesError("FILE_NOT_FOUND");
    }

    return response;
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
