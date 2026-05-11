import { z } from "zod";
import { NextRequest } from "next/server";

import { scheduleZipArchiveGenerate } from "@staaash/db/jobs";
import {
  buildZipContentKey,
  findOrCreateZipArchive,
  ZIP_ARCHIVE_STATUS_FAILED,
  ZIP_ARCHIVE_STATUS_READY,
} from "@staaash/db/zip-archives";

import { canAccessPrivateNamespace } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import {
  isSameOrigin,
  jsonErrorResponse,
  notSignedInResponse,
} from "@/server/auth/http";
import { FilesError } from "@/server/files/errors";
import { prismaFilesRepository } from "@/server/files/repository";
import { getSystemSettings } from "@/server/settings";

const bodySchema = z.object({
  ids: z.array(z.string()).min(1).max(500),
});

const ZIP_ARCHIVE_RETENTION_DEFAULT_DAYS = 7;

export async function POST(request: NextRequest): Promise<Response> {
  if (!isSameOrigin(request)) {
    return Response.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);
  if (!session) {
    return notSignedInResponse(request, "/api/files/archives");
  }

  try {
    const body = await request.json();
    const { ids } = bodySchema.parse(body);

    const fileIds: string[] = [];
    const folderIds: string[] = [];

    // Batch-fetch files and folders to determine type and verify access
    const [allFiles, allFolders] = await Promise.all([
      Promise.all(ids.map((id) => prismaFilesRepository.findFileById(id))),
      Promise.all(ids.map((id) => prismaFilesRepository.findFolderById(id))),
    ]);

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const file = allFiles[i];
      const folder = allFolders[i];

      if (file && !file.deletedAt) {
        if (
          !canAccessPrivateNamespace({
            actorRole: session.user.role,
            actorUserId: session.user.id,
            namespaceOwnerUserId: file.ownerUserId,
          })
        ) {
          throw new FilesError("ACCESS_DENIED");
        }
        fileIds.push(id);
      } else if (folder && !folder.deletedAt) {
        if (
          !canAccessPrivateNamespace({
            actorRole: session.user.role,
            actorUserId: session.user.id,
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
    const expiresAt = new Date(
      Date.now() + retentionDays * 24 * 60 * 60 * 1000,
    );

    const contentKey = buildZipContentKey(fileIds, folderIds);
    const { archive, created } = await findOrCreateZipArchive({
      userId: session.user.id,
      contentKey,
      idsJson: { fileIds, folderIds },
      expiresAt,
    });

    if (created || archive.status === ZIP_ARCHIVE_STATUS_FAILED) {
      await scheduleZipArchiveGenerate({ archiveId: archive.id });
    }

    return Response.json({
      archiveId: archive.id,
      status:
        archive.status === ZIP_ARCHIVE_STATUS_FAILED
          ? "queued"
          : archive.status,
    });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
