import { NextRequest } from "next/server";

import { findZipArchiveById } from "@staaash/db/zip-archives";

import { getRequestSession } from "@/server/auth/guards";
import { notSignedInResponse, jsonErrorResponse } from "@/server/auth/http";
import { FilesError } from "@/server/files/errors";

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
    return notSignedInResponse(request, `/api/files/archives/${archiveId}`);
  }

  try {
    const archive = await findZipArchiveById(archiveId);
    if (!archive) {
      throw new FilesError("FILE_NOT_FOUND");
    }

    return Response.json({
      status: archive.status,
      fileCount: archive.fileCount,
      sizeBytes: archive.sizeBytes?.toString() ?? null,
      error: archive.error,
    });
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
