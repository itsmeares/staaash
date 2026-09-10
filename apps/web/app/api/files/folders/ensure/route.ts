// Folder preparation intentionally follows the authenticated mutation route contract.
// fallow-ignore-file code-duplication
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getRequestSession } from "@/server/auth/guards";
import type { FilesActor } from "@/server/files/types";
import {
  isSameOrigin,
  jsonErrorResponse,
  notSignedInResponse,
} from "@/server/auth/http";
import { filesService } from "@/server/files/service";
import { recordFolderAccessBestEffort } from "@/server/retrieval/recent-tracking";
import {
  attachStorageMutationHeader,
  readStorageIdempotencyKey,
} from "@/server/storage-idempotency";

const ensureFolderPathsSchema = z.object({
  folderId: z.string().trim().min(1),
  paths: z.array(z.string().min(1).max(4096)).min(1).max(10_000),
});

const FOLDER_ACCESS_BATCH_SIZE = 8;

const trackEnsuredFolderAccess = async ({
  folders,
  actorUserId,
  actorRole,
}: FilesActor & { folders: Array<{ folderId: string }> }) => {
  for (
    let index = 0;
    index < folders.length;
    index += FOLDER_ACCESS_BATCH_SIZE
  ) {
    await Promise.all(
      folders
        .slice(index, index + FOLDER_ACCESS_BATCH_SIZE)
        .map(({ folderId }) =>
          recordFolderAccessBestEffort({
            actorUserId,
            actorRole,
            folderId,
            source: "ensure-folder-paths-route",
          }),
        ),
    );
  }
};

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin requests are not allowed." },
      { status: 403 },
    );
  }

  const session = await getRequestSession(request);
  if (!session) return notSignedInResponse(request, "/files");

  let idempotencyKey: string;
  try {
    idempotencyKey = readStorageIdempotencyKey(request);
  } catch (error) {
    return jsonErrorResponse(error);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = ensureFolderPathsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request.", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const result = await filesService.ensureFolderPaths({
      actorUserId: session.user.id,
      actorRole: session.user.role,
      parentId: parsed.data.folderId,
      paths: parsed.data.paths,
      idempotencyKey,
    });
    await trackEnsuredFolderAccess({
      folders: result.folders,
      actorUserId: session.user.id,
      actorRole: session.user.role,
    });

    return attachStorageMutationHeader(
      NextResponse.json(result, { status: 201 }),
      idempotencyKey,
      session.user.id,
    );
  } catch (error) {
    return attachStorageMutationHeader(
      jsonErrorResponse(error),
      idempotencyKey,
      session.user.id,
      error,
    );
  }
}
