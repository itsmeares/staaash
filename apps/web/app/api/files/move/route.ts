import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestSession } from "@/server/auth/guards";
import {
  isSameOrigin,
  jsonErrorResponse,
  jsonNotSignedInResponse,
} from "@/server/auth/http";
import { filesService } from "@/server/files/service";
import type { BatchMoveResponse, BatchMoveResult } from "@/server/files/types";
import {
  recordFileAccessBestEffort,
  recordFolderAccessBestEffort,
} from "@/server/retrieval/recent-tracking";

const requestSchema = z.object({
  destinationFolderId: z.string().trim().min(1),
  items: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        kind: z.enum(["file", "folder"]),
      }),
    )
    .min(1)
    .max(500),
});

const normalizeMoveFailure = (
  item: { id: string; kind: "file" | "folder" },
  error: unknown,
): BatchMoveResult => {
  if (
    error instanceof Error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return {
      ...item,
      status: "failed",
      code: (error as Error & { code: string }).code,
      error: error.message,
    };
  }

  return {
    ...item,
    status: "failed",
    code: "INTERNAL_ERROR",
    error: "Unexpected server error.",
  };
};

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);
  if (!session) return jsonNotSignedInResponse();

  try {
    const body = requestSchema.parse(await request.json());
    const results: BatchMoveResult[] = [];

    for (const item of body.items) {
      try {
        if (item.kind === "folder") {
          await filesService.moveFolder({
            actorUserId: session.user.id,
            actorRole: session.user.role,
            folderId: item.id,
            destinationFolderId: body.destinationFolderId,
          });
          await recordFolderAccessBestEffort({
            actorUserId: session.user.id,
            actorRole: session.user.role,
            folderId: item.id,
            source: "batch-move-route",
          });
        } else {
          await filesService.moveFile({
            actorUserId: session.user.id,
            actorRole: session.user.role,
            fileId: item.id,
            destinationFolderId: body.destinationFolderId,
          });
          await recordFileAccessBestEffort({
            actorUserId: session.user.id,
            actorRole: session.user.role,
            fileId: item.id,
            source: "batch-move-route",
          });
        }

        results.push({ ...item, status: "moved" });
      } catch (error) {
        results.push(normalizeMoveFailure(item, error));
      }
    }

    const movedCount = results.filter(
      (result) => result.status === "moved",
    ).length;
    const response: BatchMoveResponse = {
      movedCount,
      failedCount: results.length - movedCount,
      results,
    };

    return NextResponse.json(response);
  } catch (error) {
    return jsonErrorResponse(error);
  }
}
