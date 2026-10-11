import { NextRequest } from "next/server";

import { createInlineContentResponse } from "@/server/media/derivative-content-response";
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
    path: `/api/files/files/${fileId}/content`,
    unavailable: "Content unavailable.",
    respond: (file) => createInlineContentResponse({ request, file }),
  });
}
