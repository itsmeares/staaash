import { z } from "zod";
import { NextRequest } from "next/server";

import { scheduleZipArchiveGenerate } from "@staaash/db/jobs";
import {
  buildZipContentKey,
  findOrCreateZipArchive,
  ZIP_ARCHIVE_STATUS_FAILED,
} from "@staaash/db/zip-archives";

import { canAccessPrivateNamespace } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import {
  isSameOrigin,
  jsonErrorResponse,
  notSignedInResponse,
  readJsonBody,
} from "@/server/auth/http";
import { FilesError } from "@/server/files/errors";
import { findArchiveSelectionItems } from "@/server/files/repository";
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
    const body = await readJsonBody(request);
    const { ids } = bodySchema.parse(body);

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
            actorRole: session.user.role,
            actorUserId: session.user.id,
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
      await scheduleZipArchiveGenerate({
        archiveId: archive.id,
        sourceSizeBytes,
        fileCount: fileIds.length,
        folderCount: folderIds.length,
      });
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
