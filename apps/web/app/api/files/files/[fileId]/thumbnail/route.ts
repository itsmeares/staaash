import { NextRequest } from "next/server";

import { createThumbnailResponse } from "@/server/media/derivative-content-response";
import { respondWithPrivateFile } from "@/server/media/private-file-route";

type RouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { fileId } = await params;
  return respondWithPrivateFile({
    request,
    fileId,
    path: `/api/files/files/${fileId}/thumbnail`,
    unavailable: "Thumbnail unavailable.",
    respond: (file) => createThumbnailResponse({ request, file }),
  });
}
