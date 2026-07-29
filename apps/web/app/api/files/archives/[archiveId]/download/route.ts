import { NextRequest } from "next/server";

import {
  findZipArchiveById,
  ZIP_ARCHIVE_STATUS_READY,
} from "@staaash/db/zip-archives";

import { canAccessPrivateNamespace } from "@/server/access";
import { getRequestSession } from "@/server/auth/guards";
import { notSignedInResponse, jsonErrorResponse } from "@/server/auth/http";
import { FilesError } from "@/server/files/errors";
import { getStoragePath } from "@/server/storage";
import { createRangeResponseFromPath } from "@/server/downloads/range-response";
import {
  assertStorageEntityReadable,
  StorageEntityUnavailableError,
} from "@/server/storage-read-guard";

type RouteContext = {
  params: Promise<{ archiveId: string }>;
};

type ReadyArchive = NonNullable<
  Awaited<ReturnType<typeof findZipArchiveById>>
> & { storageKey: string };
type ArchiveActor = {
  id: string;
  role: Parameters<typeof canAccessPrivateNamespace>[0]["actorRole"];
};

const requireReadyArchive = async (
  archiveId: string,
): Promise<ReadyArchive> => {
  const archive = await findZipArchiveById(archiveId);
  if (
    !archive ||
    archive.status !== ZIP_ARCHIVE_STATUS_READY ||
    !archive.storageKey
  ) {
    throw new FilesError("FILE_NOT_FOUND");
  }
  return archive as ReadyArchive;
};

const assertArchiveOwnerAccessible = (
  ownerUserId: string,
  actor: ArchiveActor,
) => {
  if (
    !canAccessPrivateNamespace({
      actorRole: actor.role,
      actorUserId: actor.id,
      namespaceOwnerUserId: ownerUserId,
    })
  ) {
    throw new FilesError("ACCESS_DENIED");
  }
};

const createArchiveDownloadResponse = async (
  request: NextRequest,
  archive: ReadyArchive,
) => {
  const storagePath = getStoragePath(archive.storageKey);
  await assertStorageEntityReadable("archive", archive.id);
  const response = await createRangeResponseFromPath(
    request,
    storagePath,
    Number(archive.sizeBytes ?? 0),
    "application/zip",
    archive.fileName ?? "staaash-files.zip",
  );
  if (!response) throw new FilesError("FILE_NOT_FOUND");
  return response;
};

const storageUnavailableResponse = (error: StorageEntityUnavailableError) =>
  Response.json(
    { error: error.message, code: error.code },
    {
      status: error.status,
      headers: { "X-Storage-Mutation-Id": error.mutationId },
    },
  );

// Archive GET routes intentionally share authorization and state translation.
// fallow-ignore-next-line code-duplication
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
    const archive = await requireReadyArchive(archiveId);
    assertArchiveOwnerAccessible(archive.userId, session.user);
    return createArchiveDownloadResponse(request, archive);
  } catch (error) {
    if (error instanceof StorageEntityUnavailableError) {
      return storageUnavailableResponse(error);
    }
    return jsonErrorResponse(error);
  }
}
